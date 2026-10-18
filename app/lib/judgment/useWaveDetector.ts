// 判定層：從手腕 x 座標的軌跡判斷是否在揮手。
// 揮手是動態動作，靜態手勢分類（Open_Palm）判斷不了，所以追蹤折返點：
// 時間視窗內方向反轉夠多次、擺幅夠大，才算一次揮手。
// 只看「有沒有反轉」不看方向，所以畫面鏡像與否不影響結果。
import type { FrameFacts } from '../perception/types'
import { WAVE_CONFIG, type WaveConfig } from './config'

interface Sample {
  x: number
  t: number
}

export interface WaveState {
  /** 已確認的折返點（只保留視窗內的） */
  extremes: readonly Sample[]
  /** 目前方向上走最遠的點，反向超過 deadband 時成為新的折返點 */
  peak: Sample | null
  /** 1 往右、-1 往左、0 尚未確定 */
  direction: -1 | 0 | 1
  lastSeenAt: number | null
  lastWaveAt: number | null
}

export interface WaveMetrics {
  /** 視窗內的折返次數 */
  reversals: number
  /** 視窗內手腕 x 的最大擺幅 */
  amplitude: number
  /** 第一個折返點到現在的時間 */
  spanMs: number
}

export type WaveInput = Pick<FrameFacts, 't' | 'hand'>

export interface WaveStep {
  state: WaveState
  metrics: WaveMetrics
  /** 這一幀是否判定為揮手 */
  wave: boolean
}

export function initialWave(): WaveState {
  return { extremes: [], peak: null, direction: 0, lastSeenAt: null, lastWaveAt: null }
}

function measure(extremes: readonly Sample[], peak: Sample | null, t: number): WaveMetrics {
  const first = extremes[0]
  if (!first) return { reversals: 0, amplitude: 0, spanMs: 0 }
  const xs = extremes.map((e) => e.x)
  if (peak) xs.push(peak.x)
  return {
    reversals: extremes.length,
    amplitude: Math.max(...xs) - Math.min(...xs),
    spanMs: t - first.t,
  }
}

export function stepWave(
  s: WaveState,
  input: WaveInput,
  cfg: WaveConfig = WAVE_CONFIG,
): WaveStep {
  const { t } = input
  const x = input.hand?.wrist.x ?? null

  if (x === null) {
    // 寬限內保留軌跡；超過就清掉，下次重新累積
    const lost = s.lastSeenAt === null || t - s.lastSeenAt > cfg.dropoutGraceMs
    const state = lost ? { ...initialWave(), lastWaveAt: s.lastWaveAt } : s
    return { state, metrics: measure(state.extremes, state.peak, t), wave: false }
  }

  // 寬限外才重新出現的手，舊軌跡不可信
  const stale = s.lastSeenAt !== null && t - s.lastSeenAt > cfg.dropoutGraceMs
  let { peak, direction } = stale ? initialWave() : s
  let extremes = (stale ? [] : s.extremes).filter((e) => t - e.t <= cfg.windowMs)
  const current: Sample = { x, t }

  if (peak === null) {
    peak = current
  } else if (direction === 0) {
    const delta = x - peak.x
    if (Math.abs(delta) >= cfg.deadband) {
      // 第一段位移只用來確定方向，起點不算折返
      direction = delta > 0 ? 1 : -1
      peak = current
    }
  } else if ((x - peak.x) * direction > 0) {
    peak = current
  } else if ((peak.x - x) * direction >= cfg.deadband) {
    extremes = [...extremes, peak]
    direction = direction === 1 ? -1 : 1
    peak = current
  }

  const metrics = measure(extremes, peak, t)
  const ready = s.lastWaveAt === null || t - s.lastWaveAt >= cfg.refractoryMs
  const wave = ready && metrics.reversals >= cfg.minReversals && metrics.amplitude >= cfg.minAmplitude

  let lastWaveAt = s.lastWaveAt
  if (wave) {
    // 觸發後清掉折返點，下一次揮手要重新累積
    lastWaveAt = t
    extremes = []
  }

  return {
    state: { extremes, peak, direction, lastSeenAt: t, lastWaveAt },
    metrics,
    wave,
  }
}

/** 包一層可變的外殼，方便在迴圈裡逐幀呼叫；核心仍是上面的純函式 */
export function useWaveDetector(cfg: WaveConfig = WAVE_CONFIG) {
  let state = initialWave()
  let metrics: WaveMetrics = { reversals: 0, amplitude: 0, spanMs: 0 }
  return {
    get state(): WaveState {
      return state
    },
    get metrics(): WaveMetrics {
      return metrics
    },
    update(input: WaveInput): boolean {
      const next = stepWave(state, input, cfg)
      state = next.state
      metrics = next.metrics
      return next.wave
    },
    reset(): void {
      state = initialWave()
      metrics = { reversals: 0, amplitude: 0, spanMs: 0 }
    },
  }
}
