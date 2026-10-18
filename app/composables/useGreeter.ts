// 組裝：感知層 → 判定層 → 畫面回應，三種模式：
// - rules：v1 原樣，MediaPipe + 手寫規則
// - hybrid：MediaPipe 照舊，狀態機進 greeted 前多一道 Jev 關卡（adapter）
// - image：實驗性，感知層換成 JevImageProvider（影像會上傳），判定層不變
import { DETECTION_FPS, WAVE_CONFIG } from '~/lib/judgment/config'
import {
  usePresenceStateMachine,
  type PresencePhase,
  type PresenceTransition,
} from '~/lib/judgment/usePresenceStateMachine'
import { useWaveDetector, type WaveMetrics } from '~/lib/judgment/useWaveDetector'
import { acceptVerdict, initialHybrid, stepHybrid, type GateDecision } from '~/lib/hybrid/adapter'
import { ruleVerdict } from '~/lib/hybrid/verdicts'
import { createFactWindow, formatSummary, summarizeFacts } from '~/lib/jev/fact-serializer'
import { loadHandConnections, MediaPipeProvider } from '~/lib/perception/mediapipe-provider'
import type { FrameFacts, PerceptionProvider, ProviderInfo } from '~/lib/perception/types'

export type GreeterStatus = 'idle' | 'loading' | 'running' | 'error'
export type GreeterMode = 'rules' | 'hybrid' | 'image'

export interface Reaction {
  kind: 'greet' | 'wave'
  text: string
  t: number
}

const REACTION_MS = 2500
const TRANSITION_LOG_SIZE = 8
/** Image 模式：P(揮手) 達到這個值視為揮手 */
const IMAGE_WAVE_THRESHOLD = 0.5

const GREETINGS = ['嗨！歡迎光臨 👋', '哈囉，你好呀！', '嘿，看到你了！']
const WAVE_REPLIES = ['👋 你也好！', '👋👋 揮回去！', '收到你的招手了 🙌']

function pick(list: readonly string[]): string {
  return list[Math.floor(Math.random() * list.length)] ?? list[0]!
}

export function useGreeter() {
  const camera = useCamera()
  const mediapipe = shallowRef<MediaPipeProvider | null>(null)
  const info = ref<ProviderInfo | null>(null)
  const status = ref<GreeterStatus>('idle')
  const errorMessage = ref<string | null>(null)

  const mode = ref<GreeterMode>('rules')
  /** 使用者是否明確同意 Image 模式上傳影像 */
  const imageConsent = ref(false)
  const imageFps = ref(3)

  const waveEnabled = ref(false)
  const gestureLoading = ref(false)
  const connections = shallowRef<ReadonlyArray<{ start: number; end: number }>>([])

  const facts = shallowRef<FrameFacts | null>(null)
  const phase = ref<PresencePhase>('idle')
  const transitions = ref<PresenceTransition[]>([])
  const waveMetrics = shallowRef<WaveMetrics>({ reversals: 0, amplitude: 0, spanMs: 0 })
  const waveCount = ref(0)
  const reaction = ref<Reaction | null>(null)
  /** 目前事實的文字 state（給畫面預覽與校準實驗凍結用） */
  const stateText = ref<string | null>(null)
  /** Hybrid：最近一次規則想打招呼時，Jev 關卡的決定 */
  const gate = ref<GateDecision | null>(null)

  const presence = usePresenceStateMachine()
  const wave = useWaveDetector()
  const factWindow = createFactWindow()
  let hybrid = initialHybrid(0)
  let lastImageWaveAt: number | null = null
  let reactionTimer: ReturnType<typeof setTimeout> | null = null

  const compare = useJevCompare()
  const image = useImageCompare(() => mediapipe.value)

  const provider = computed<PerceptionProvider | null>(() =>
    mode.value === 'image' ? image.provider : mediapipe.value,
  )
  const targetFps = computed(() => {
    if (mode.value === 'image') return imageFps.value
    return waveEnabled.value ? DETECTION_FPS.wave : DETECTION_FPS.face
  })

  function react(kind: Reaction['kind'], t: number) {
    reaction.value = { kind, text: pick(kind === 'greet' ? GREETINGS : WAVE_REPLIES), t }
    if (reactionTimer !== null) clearTimeout(reactionTimer)
    reactionTimer = setTimeout(() => (reaction.value = null), REACTION_MS)
  }

  function logTransitions(changes: PresenceTransition[], t: number) {
    if (changes.length === 0) return
    transitions.value = [...[...changes].reverse(), ...transitions.value].slice(0, TRANSITION_LOG_SIZE)
    if (changes.some((c) => c.to === 'greeted')) react('greet', t)
  }

  /** Hybrid：把目前事實轉成文字問 Jev，同時記下同一批事實上的規則判定 */
  function askJev(t: number) {
    const summary = summarizeFacts(factWindow.frames)
    if (!summary) return
    const rule = ruleVerdict(summary, hybrid.presence)
    void compare.ask(formatSummary(summary), t, rule).then((verdict) => {
      if (verdict) hybrid = acceptVerdict(hybrid, verdict)
    })
  }

  function onFacts(f: FrameFacts) {
    facts.value = f
    factWindow.push(f)
    stateText.value = mode.value === 'image' ? null : formatSummary(summarizeFacts(factWindow.frames)!)

    if (mode.value === 'hybrid') {
      const step = stepHybrid(hybrid, { ...f, judgeBusy: compare.judge.busy })
      hybrid = step.state
      phase.value = hybrid.presence.phase
      if (step.gate) gate.value = step.gate
      logTransitions(step.transitions, f.t)
      if (step.ask) askJev(f.t)
    } else {
      // rules 與 image 用同一個未修改的狀態機
      logTransitions(presence.update(f), f.t)
      phase.value = presence.state.phase
    }

    if (mode.value === 'image') {
      void image.onFacts(f)
      // 沒有關節點，揮手直接看 Jev 的機率；不反應期沿用規則的設定
      const p = f.waving ?? 0
      const ready = lastImageWaveAt === null || f.t - lastImageWaveAt >= WAVE_CONFIG.refractoryMs
      if (p >= IMAGE_WAVE_THRESHOLD && ready) {
        lastImageWaveAt = f.t
        waveCount.value++
        react('wave', f.t)
      }
    } else if (f.handTracking) {
      const waved = wave.update(f)
      waveMetrics.value = wave.metrics
      if (waved) {
        waveCount.value++
        react('wave', f.t)
      }
    }
  }

  const loop = useDetectionLoop({
    video: camera.video,
    provider: () => provider.value,
    fps: () => targetFps.value,
    onFacts,
  })

  function resetJudgment() {
    const now = performance.now()
    presence.reset(now)
    hybrid = initialHybrid(now)
    wave.reset()
    waveMetrics.value = wave.metrics
    factWindow.clear()
    lastImageWaveAt = null
    phase.value = 'idle'
    gate.value = null
    transitions.value = []
    facts.value = null
    stateText.value = null
  }

  async function start() {
    if (status.value === 'loading' || status.value === 'running') return
    status.value = 'loading'
    errorMessage.value = null
    try {
      const mp = new MediaPipeProvider()
      info.value = await mp.init()
      mediapipe.value = mp
      if (waveEnabled.value) await applyWave(true)
      await camera.start()
      resetJudgment()
      loop.start()
      status.value = 'running'
    } catch (err) {
      console.error('[greeter] 啟動失敗', err)
      errorMessage.value = err instanceof Error ? err.message : String(err)
      status.value = 'error'
    }
  }

  function stop() {
    loop.stop()
    camera.stop()
    mediapipe.value?.dispose()
    mediapipe.value = null
    info.value = null
    resetJudgment()
    status.value = 'idle'
  }

  async function applyWave(on: boolean) {
    const p = mediapipe.value
    if (!p) return
    if (on && connections.value.length === 0) connections.value = await loadHandConnections()
    gestureLoading.value = on
    try {
      info.value = await p.setHandTracking(on)
    } catch (err) {
      console.error('[greeter] 手勢模型載入失敗', err)
      errorMessage.value = '手勢模型載入失敗，請確認已執行 pnpm setup:models'
      waveEnabled.value = false
    } finally {
      gestureLoading.value = false
    }
    if (!on) {
      wave.reset()
      waveMetrics.value = wave.metrics
    }
  }

  watch(waveEnabled, (on) => void applyWave(on))

  watch(imageConsent, (ok) => {
    // 撤回同意時立刻離開 Image 模式
    if (!ok && mode.value === 'image') mode.value = 'rules'
  })

  watch(mode, (next, prev) => {
    if (next === 'image' && !imageConsent.value) {
      mode.value = prev
      return
    }
    // 切換引擎時重啟迴圈，丟掉舊引擎還在途的結果；判定層狀態也從頭開始
    const running = loop.running.value
    loop.stop()
    resetJudgment()
    if (running) loop.start()
  })

  onBeforeUnmount(() => {
    if (reactionTimer !== null) clearTimeout(reactionTimer)
    mediapipe.value?.dispose()
  })

  return {
    camera,
    status,
    errorMessage,
    info,
    mode,
    imageConsent,
    imageFps,
    waveEnabled,
    gestureLoading,
    connections,
    facts,
    phase,
    transitions,
    waveMetrics,
    waveCount,
    reaction,
    stateText,
    gate,
    compare,
    image,
    targetFps,
    actualFps: loop.actualFps,
    inferenceMs: loop.inferenceMs,
    start,
    stop,
  }
}
