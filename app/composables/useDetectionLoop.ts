// 偵測迴圈：rAF 一直跑，雙閘門決定這一圈要不要推論。
import type { FrameFacts, PerceptionProvider } from '~/lib/perception/types'
import { initialGate, passGate } from '~/lib/loop/frame-gate'
import { createRateMeter } from '~/lib/loop/rate-meter'

export interface DetectionLoopOptions {
  video: HTMLVideoElement
  provider: () => PerceptionProvider | null
  fps: () => number
  onFacts: (facts: FrameFacts) => void
}

export function useDetectionLoop({ video, provider, fps, onFacts }: DetectionLoopOptions) {
  const running = ref(false)
  /** 實測推論頻率 */
  const actualFps = ref(0)
  /** 單次推論耗時（ms） */
  const inferenceMs = ref(0)

  const meter = createRateMeter(1000)
  let gate = initialGate()
  let rafId: number | null = null
  let lastErrorAt = 0

  function tick() {
    rafId = requestAnimationFrame(tick)
    const p = provider()
    // HAVE_CURRENT_DATA 之前沒有畫面可推論
    if (!p || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return

    // 節流與推論共用同一個 timestamp，保證送進 MediaPipe 的值單調遞增
    const now = performance.now()
    const result = passGate(gate, { now, videoTime: video.currentTime, fps: fps() })
    gate = result.gate
    if (!result.run) return

    try {
      const facts = p.detect(video, now)
      inferenceMs.value = performance.now() - now
      meter.tick(now)
      onFacts(facts)
    } catch (err) {
      // 每秒最多記一次，避免洗版
      if (now - lastErrorAt > 1000) console.error('[loop] 推論失敗', err)
      lastErrorAt = now
    }
    actualFps.value = meter.rate(now)
  }

  function start() {
    if (rafId !== null) return
    gate = initialGate()
    running.value = true
    rafId = requestAnimationFrame(tick)
  }

  function stop() {
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = null
    running.value = false
    actualFps.value = 0
  }

  onBeforeUnmount(stop)

  return { running, actualFps, inferenceMs, start, stop }
}
