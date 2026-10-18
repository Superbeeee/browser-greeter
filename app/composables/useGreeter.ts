// 組裝：感知層（MediaPipeProvider）→ 判定層（狀態機、揮手）→ 畫面回應
import { DETECTION_FPS } from '~/lib/judgment/config'
import {
  usePresenceStateMachine,
  type PresencePhase,
  type PresenceTransition,
} from '~/lib/judgment/usePresenceStateMachine'
import { useWaveDetector, type WaveMetrics } from '~/lib/judgment/useWaveDetector'
import { loadHandConnections, MediaPipeProvider } from '~/lib/perception/mediapipe-provider'
import type { FrameFacts, PerceptionProvider, ProviderInfo } from '~/lib/perception/types'

export type GreeterStatus = 'idle' | 'loading' | 'running' | 'error'

export interface Reaction {
  kind: 'greet' | 'wave'
  text: string
  t: number
}

const REACTION_MS = 2500
const TRANSITION_LOG_SIZE = 8

const GREETINGS = ['嗨！歡迎光臨 👋', '哈囉，你好呀！', '嘿，看到你了！']
const WAVE_REPLIES = ['👋 你也好！', '👋👋 揮回去！', '收到你的招手了 🙌']

function pick(list: readonly string[]): string {
  return list[Math.floor(Math.random() * list.length)] ?? list[0]!
}

export function useGreeter() {
  const camera = useCamera()
  const provider = shallowRef<PerceptionProvider | null>(null)
  const info = ref<ProviderInfo | null>(null)
  const status = ref<GreeterStatus>('idle')
  const errorMessage = ref<string | null>(null)

  const waveEnabled = ref(false)
  const gestureLoading = ref(false)
  const connections = shallowRef<ReadonlyArray<{ start: number; end: number }>>([])

  const facts = shallowRef<FrameFacts | null>(null)
  const phase = ref<PresencePhase>('idle')
  const transitions = ref<PresenceTransition[]>([])
  const waveMetrics = shallowRef<WaveMetrics>({ reversals: 0, amplitude: 0, spanMs: 0 })
  const waveCount = ref(0)
  const reaction = ref<Reaction | null>(null)

  const presence = usePresenceStateMachine()
  const wave = useWaveDetector()
  let reactionTimer: ReturnType<typeof setTimeout> | null = null

  const targetFps = computed(() => (waveEnabled.value ? DETECTION_FPS.wave : DETECTION_FPS.face))

  function react(kind: Reaction['kind'], t: number) {
    reaction.value = { kind, text: pick(kind === 'greet' ? GREETINGS : WAVE_REPLIES), t }
    if (reactionTimer !== null) clearTimeout(reactionTimer)
    reactionTimer = setTimeout(() => (reaction.value = null), REACTION_MS)
  }

  function onFacts(f: FrameFacts) {
    facts.value = f

    const changes = presence.update(f)
    phase.value = presence.state.phase
    if (changes.length > 0) {
      transitions.value = [...changes.reverse(), ...transitions.value].slice(0, TRANSITION_LOG_SIZE)
      if (changes.some((c) => c.to === 'greeted')) react('greet', f.t)
    }

    if (f.handTracking) {
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

  async function start() {
    if (status.value === 'loading' || status.value === 'running') return
    status.value = 'loading'
    errorMessage.value = null
    try {
      const mp = new MediaPipeProvider()
      info.value = await mp.init()
      provider.value = mp
      if (waveEnabled.value) await applyWave(true)
      await camera.start()
      presence.reset(performance.now())
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
    provider.value?.dispose()
    provider.value = null
    info.value = null
    facts.value = null
    status.value = 'idle'
  }

  async function applyWave(on: boolean) {
    const p = provider.value
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

  onBeforeUnmount(() => {
    if (reactionTimer !== null) clearTimeout(reactionTimer)
    provider.value?.dispose()
  })

  return {
    camera,
    status,
    errorMessage,
    info,
    waveEnabled,
    gestureLoading,
    connections,
    facts,
    phase,
    transitions,
    waveMetrics,
    waveCount,
    reaction,
    targetFps,
    actualFps: loop.actualFps,
    inferenceMs: loop.inferenceMs,
    start,
    stop,
  }
}
