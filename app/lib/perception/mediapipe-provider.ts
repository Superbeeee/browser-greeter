import type {
  Category,
  FaceDetector,
  GestureRecognizer,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import {
  GESTURE_NAMES,
  type Delegate,
  type FaceFact,
  type FrameFacts,
  type GestureName,
  type HandFact,
  type PerceptionProvider,
  type ProviderInfo,
} from './types'

type Vision = typeof import('@mediapipe/tasks-vision')
// WasmFileset 在 vision.d.ts 只有 declare、沒有 export，從回傳值推導
type WasmFileset = Awaited<ReturnType<Vision['FilesetResolver']['forVisionTasks']>>

export interface MediaPipeProviderOptions {
  /** wasm 所在目錄，對應 public/mediapipe/wasm */
  wasmPath: string
  faceModelPath: string
  gestureModelPath: string
  minFaceConfidence: number
}

export const DEFAULT_MEDIAPIPE_OPTIONS: MediaPipeProviderOptions = {
  wasmPath: '/mediapipe/wasm',
  faceModelPath: '/mediapipe/blaze_face_short_range.tflite',
  gestureModelPath: '/mediapipe/gesture_recognizer.task',
  minFaceConfidence: 0.5,
}

const DELEGATES: readonly Delegate[] = ['GPU', 'CPU']

/** 依序嘗試 GPU → CPU，回傳第一個建立成功的實例 */
async function createWithFallback<T>(
  label: string,
  create: (delegate: Delegate) => Promise<T>,
): Promise<{ instance: T; delegate: Delegate }> {
  let lastError: unknown
  for (const delegate of DELEGATES) {
    try {
      const instance = await create(delegate)
      console.info(`[mediapipe] ${label} 使用 ${delegate} delegate`)
      return { instance, delegate }
    } catch (err) {
      lastError = err
      console.warn(`[mediapipe] ${label} 的 ${delegate} delegate 建立失敗，改試下一個`, err)
    }
  }
  throw new Error(`[mediapipe] ${label} 所有 delegate 都建立失敗`, { cause: lastError })
}

function isGestureName(name: string): name is GestureName {
  return (GESTURE_NAMES as readonly string[]).includes(name)
}

function toGesture(categories: Category[] | undefined): HandFact['gesture'] {
  const top = categories?.[0]
  if (!top || !isGestureName(top.categoryName)) return null
  return { name: top.categoryName, score: top.score }
}

function toHand(landmarks: NormalizedLandmark[], gestures: Category[] | undefined): HandFact | null {
  const wrist = landmarks[0]
  if (!wrist) return null
  return {
    gesture: toGesture(gestures),
    landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })),
    wrist: { x: wrist.x, y: wrist.y },
  }
}

export class MediaPipeProvider implements PerceptionProvider {
  readonly name = 'MediaPipe'

  private vision: Vision | null = null
  private fileset: WasmFileset | null = null
  private face: FaceDetector | null = null
  private gesture: GestureRecognizer | null = null
  private gestureLoading: Promise<void> | null = null
  private handTracking = false
  private info: ProviderInfo = { face: 'CPU', gesture: null }

  constructor(private readonly options: MediaPipeProviderOptions = DEFAULT_MEDIAPIPE_OPTIONS) {}

  async init(): Promise<ProviderInfo> {
    // 懶載入：套件本體與 wasm 都等到真的要用才下載
    const vision = await import('@mediapipe/tasks-vision')
    this.vision = vision
    this.fileset = await vision.FilesetResolver.forVisionTasks(this.options.wasmPath)

    const fileset = this.fileset
    const { instance, delegate } = await createWithFallback('FaceDetector', (d) =>
      vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.options.faceModelPath, delegate: d },
        runningMode: 'VIDEO',
        minDetectionConfidence: this.options.minFaceConfidence,
      }),
    )
    this.face = instance
    this.info = { ...this.info, face: delegate }
    return this.info
  }

  async setHandTracking(enabled: boolean): Promise<ProviderInfo> {
    // 先記下想要的狀態；detect() 會同時確認模型已載入。
    // 載入中途被關掉時，載入完成也不會誤開。
    this.handTracking = enabled
    if (enabled && !this.gesture) {
      // 失敗時清掉，讓下次開啟可以重試
      this.gestureLoading ??= this.loadGesture().catch((err: unknown) => {
        this.gestureLoading = null
        throw err
      })
      await this.gestureLoading
    }
    return this.info
  }

  private async loadGesture(): Promise<void> {
    const { vision, fileset } = this
    if (!vision || !fileset) throw new Error('[mediapipe] 請先呼叫 init()')
    const { instance, delegate } = await createWithFallback('GestureRecognizer', (d) =>
      vision.GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.options.gestureModelPath, delegate: d },
        runningMode: 'VIDEO',
        numHands: 1,
      }),
    )
    this.gesture = instance
    this.info = { ...this.info, gesture: delegate }
  }

  // MediaPipe 本身是同步的，包成 Promise 以符合介面
  async detect(video: HTMLVideoElement, t: number): Promise<FrameFacts> {
    if (!this.face) throw new Error('[mediapipe] 請先呼叫 init()')
    const handTracking = this.handTracking && this.gesture !== null
    return {
      t,
      face: this.detectFace(video, t),
      hand: handTracking ? this.detectHand(video, t) : null,
      handTracking,
    }
  }

  private detectFace(video: HTMLVideoElement, t: number): FaceFact | null {
    const { detections } = this.face!.detectForVideo(video, t)
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) return null

    let best: FaceFact | null = null
    for (const detection of detections) {
      const box = detection.boundingBox
      const score = detection.categories[0]?.score ?? 0
      if (!box || (best && score <= best.score)) continue
      best = {
        widthRatio: box.width / width,
        score,
        box: {
          x: box.originX / width,
          y: box.originY / height,
          width: box.width / width,
          height: box.height / height,
        },
      }
    }
    return best
  }

  private detectHand(video: HTMLVideoElement, t: number): HandFact | null {
    const result = this.gesture!.recognizeForVideo(video, t)
    const landmarks = result.landmarks[0]
    return landmarks ? toHand(landmarks, result.gestures[0]) : null
  }

  dispose(): void {
    this.face?.close()
    this.gesture?.close()
    this.face = null
    this.gesture = null
    this.gestureLoading = null
    this.handTracking = false
  }
}

/** 給 overlay 畫骨架用；回傳 GestureRecognizer 內建的連線表 */
export async function loadHandConnections(): Promise<ReadonlyArray<{ start: number; end: number }>> {
  const { GestureRecognizer } = await import('@mediapipe/tasks-vision')
  return GestureRecognizer.HAND_CONNECTIONS
}
