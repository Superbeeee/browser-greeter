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
  // 上一次推論還沒結束就不送下一幀（v2：遠端引擎一次要幾百毫秒）
  let inFlight = false
  // 停止或重啟後，還在途的舊結果直接丟掉
  let generation = 0

  function tick() {
    rafId = requestAnimationFrame(tick)
    const p = provider()
    // HAVE_CURRENT_DATA 之前沒有畫面可推論
    if (!p || inFlight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return

    // 節流與推論共用同一個 timestamp，保證送進引擎的值單調遞增
    const now = performance.now()
    const result = passGate(gate, { now, videoTime: video.currentTime, fps: fps() })
    gate = result.gate
    if (!result.run) return

    inFlight = true
    const gen = generation
    p.detect(video, now)
      .then((facts) => {
        if (gen !== generation) return
        inferenceMs.value = performance.now() - now
        meter.tick(now)
        actualFps.value = meter.rate(performance.now())
        onFacts(facts)
      })
      .catch((err: unknown) => {
        // 每秒最多記一次，避免洗版
        if (now - lastErrorAt > 1000) console.error('[loop] 推論失敗', err)
        lastErrorAt = now
      })
      .finally(() => {
        if (gen === generation) inFlight = false
      })
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
    generation++
    inFlight = false
    running.value = false
    actualFps.value = 0
  }

  onBeforeUnmount(stop)

  return { running, actualFps, inferenceMs, start, stop }
}
