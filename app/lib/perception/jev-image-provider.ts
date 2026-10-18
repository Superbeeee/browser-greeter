// 實驗性：把鏡頭畫面直接送給 Jev，當成另一個感知引擎。
// 輸出跟 MediaPipeProvider 相同格式的 FrameFacts，接到原本的判定層，驗證「換偵測引擎，判定層不用改」。
// 注意：這個 provider 會把影像上傳到 TypeSafe；只在使用者明確開啟 Image 模式時才建立。
import { createJevJudge, type JevJudge, type JevRecord } from '../jev/judge'
import { sendImage } from '../jev/transport'
import type { FaceFact, FrameFacts, PerceptionProvider, ProviderInfo } from './types'

export interface JevImageProviderOptions {
  /** 送出影像的尺寸；比例跟鏡頭一樣，框座標才能直接對回原畫面 */
  width: number
  height: number
  /** JPEG 品質 0~1 */
  quality: number
  /** P(有人) 達到這個值才把 box 當成臉 */
  personThreshold: number
  /** 擷取畫面的那一刻呼叫，讓呼叫端用同一幀跑 MediaPipe 做對照 */
  onCapture?: (video: HTMLVideoElement, t: number) => void
  /** 每次請求結束（含失敗）呼叫 */
  onRecord?: (record: JevRecord<'image'>) => void
}

export const JEV_IMAGE_OPTIONS: JevImageProviderOptions = {
  width: 320,
  height: 240,
  quality: 0.7,
  personThreshold: 0.5,
}

export class JevImageProvider implements PerceptionProvider {
  readonly name = 'Jev Image'
  readonly judge: JevJudge<'image', Blob>
  private readonly canvas: OffscreenCanvas
  private readonly options: JevImageProviderOptions

  constructor(options: Partial<JevImageProviderOptions> = {}) {
    this.options = { ...JEV_IMAGE_OPTIONS, ...options }
    this.canvas = new OffscreenCanvas(this.options.width, this.options.height)
    // 影像不保存：describe 回傳 null，紀錄與匯出檔裡只有答案與用量
    this.judge = createJevJudge({ set: 'image', send: sendImage, describe: () => null })
  }

  async init(): Promise<ProviderInfo> {
    return { face: 'remote', gesture: 'remote' }
  }

  /** 揮手是每次都問的題目，不需要另外開關 */
  async setHandTracking(): Promise<ProviderInfo> {
    return this.init()
  }

  async detect(video: HTMLVideoElement, t: number): Promise<FrameFacts> {
    this.options.onCapture?.(video, t)

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('[jev-image] 無法建立 canvas context')
    ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height)
    const jpeg = await this.canvas.convertToBlob({ type: 'image/jpeg', quality: this.options.quality })

    const record = await this.judge.ask(jpeg, t)
    if (record) this.options.onRecord?.(record)
    // 失敗時不產生事實：寧可這一幀沒有資料，也不要假裝「沒有臉」
    if (!record) throw new Error('[jev-image] 前一個請求還在途')
    if (!record.answers) throw new Error(`[jev-image] ${record.error ?? '請求失敗'}`)

    const { person, face, waving } = record.answers
    let faceFact: FaceFact | null = null
    if (person.noul >= this.options.personThreshold) {
      const { top, bottom, left, right } = face.box
      const width = Math.max(0, right - left)
      faceFact = {
        widthRatio: width,
        score: face.confidence ?? person.noul,
        box: { x: left, y: top, width, height: Math.max(0, bottom - top) },
      }
    }

    return { t, face: faceFact, hand: null, handTracking: false, waving: waving.noul }
  }

  dispose(): void {
    // 沒有需要釋放的資源；在途的請求由偵測迴圈的 generation 丟棄結果
  }
}
