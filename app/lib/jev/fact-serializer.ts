// FactSerializer：把一段時間窗內的逐幀事實，轉成給 Jev 看的精簡文字 state。
// 只描述 MediaPipe 看到的事實，不放規則判定的結論（避免誘導 Jev 附和規則）。
// 揮手的折返統計直接重用判定層的 stepWave，不另寫一套。
import { WAVE_CONFIG } from '../judgment/config'
import { initialWave, stepWave, type WaveMetrics } from '../judgment/useWaveDetector'
import type { FrameFacts, GestureName } from '../perception/types'

export type Trend = 'growing' | 'stable' | 'shrinking'

export interface SerializerConfig {
  /** 緩衝區保留多久的事實 */
  windowMs: number
  /** 用最近多久的臉寬比算趨勢 */
  trendMs: number
  /** 臉寬比每秒變化超過這個值才算變大或變小 */
  trendPerSecond: number
  /** 臉消失不超過這麼久仍視為「持續在場」 */
  presenceGapMs: number
}

export const SERIALIZER_CONFIG: SerializerConfig = {
  windowMs: 5000,
  trendMs: 1000,
  trendPerSecond: 0.03,
  presenceGapMs: 400,
}

export interface FaceSummary {
  ratio: number
  /** 連續在場多久 */
  presentMs: number
  /** 在場時間是否已經超過緩衝區長度（實際可能更久） */
  presentCapped: boolean
  /** 樣本不足時為 null */
  trend: Trend | null
}

export type HandSummary =
  | { kind: 'untracked' }
  | { kind: 'absent' }
  | { kind: 'present'; wave: WaveMetrics; gesture: { name: GestureName; score: number } | null }

export interface FactSummary {
  t: number
  face: FaceSummary | null
  /** 沒有臉時，距離最後一次看到臉多久；緩衝區內都沒看到則為 null */
  faceGoneMs: number | null
  hand: HandSummary
}

/** 最小平方法斜率（每毫秒） */
function slope(points: ReadonlyArray<{ t: number; v: number }>): number {
  const n = points.length
  const meanT = points.reduce((s, p) => s + p.t, 0) / n
  const meanV = points.reduce((s, p) => s + p.v, 0) / n
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.t - meanT) * (p.v - meanV)
    den += (p.t - meanT) ** 2
  }
  return den === 0 ? 0 : num / den
}

function summarizeFace(frames: readonly FrameFacts[], cfg: SerializerConfig): Pick<FactSummary, 'face' | 'faceGoneMs'> {
  const latest = frames.at(-1)!
  if (!latest.face) {
    const lastSeen = frames.findLast((f) => f.face !== null)
    return { face: null, faceGoneMs: lastSeen ? latest.t - lastSeen.t : null }
  }

  // 從最新一幀往回找，掉幀不超過 presenceGapMs 都算連續在場
  let since = latest.t
  let lastFaceT = latest.t
  let reachedStart = true
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!
    if (f.face) {
      since = f.t
      lastFaceT = f.t
    } else if (lastFaceT - f.t > cfg.presenceGapMs) {
      reachedStart = false
      break
    }
  }
  // 一路在場到緩衝區開頭，而且緩衝區已經滿了，才代表實際在場時間可能更久
  const bufferFull = latest.t - frames[0]!.t >= cfg.windowMs - cfg.presenceGapMs
  const capped = reachedStart && bufferFull

  const recent = frames
    .filter((f) => f.face && latest.t - f.t <= cfg.trendMs)
    .map((f) => ({ t: f.t, v: f.face!.widthRatio }))
  let trend: Trend | null = null
  if (recent.length >= 3) {
    const perSecond = slope(recent) * 1000
    trend = perSecond > cfg.trendPerSecond ? 'growing' : perSecond < -cfg.trendPerSecond ? 'shrinking' : 'stable'
  }

  return {
    face: { ratio: latest.face.widthRatio, presentMs: latest.t - since, presentCapped: capped, trend },
    faceGoneMs: null,
  }
}

function summarizeHand(frames: readonly FrameFacts[]): HandSummary {
  const latest = frames.at(-1)!
  if (!latest.handTracking) return { kind: 'untracked' }

  const recent = frames.filter((f) => f.handTracking && latest.t - f.t <= WAVE_CONFIG.windowMs)
  const lastHand = recent.findLast((f) => f.hand !== null)?.hand
  if (!lastHand) return { kind: 'absent' }

  // 門檻設成無限大，只拿統計值、不會觸發揮手而清掉軌跡
  const neverFire = { ...WAVE_CONFIG, minReversals: Number.POSITIVE_INFINITY }
  let state = initialWave()
  let wave: WaveMetrics = { reversals: 0, amplitude: 0, spanMs: 0 }
  for (const f of recent) {
    const next = stepWave(state, f, neverFire)
    state = next.state
    wave = next.metrics
  }
  return { kind: 'present', wave, gesture: lastHand.gesture }
}

export function summarizeFacts(
  frames: readonly FrameFacts[],
  cfg: SerializerConfig = SERIALIZER_CONFIG,
): FactSummary | null {
  const latest = frames.at(-1)
  if (!latest) return null
  return { t: latest.t, ...summarizeFace(frames, cfg), hand: summarizeHand(frames) }
}

const TREND_TEXT: Record<Trend, string> = { growing: '變大', stable: '穩定', shrinking: '變小' }

const sec = (ms: number) => (ms / 1000).toFixed(1)

export function formatSummary(s: FactSummary, cfg: SerializerConfig = SERIALIZER_CONFIG): string {
  const parts: string[] = []

  if (s.face) {
    const duration = s.face.presentCapped ? `${sec(cfg.windowMs)} 秒以上` : `${sec(s.face.presentMs)} 秒`
    const trend = s.face.trend ? `趨勢${TREND_TEXT[s.face.trend]}` : '趨勢不明'
    parts.push(`臉寬比 ${s.face.ratio.toFixed(2)}，已持續 ${duration}，${trend}`)
  } else if (s.faceGoneMs !== null) {
    parts.push(`沒有偵測到臉（已消失 ${sec(s.faceGoneMs)} 秒）`)
  } else {
    parts.push(`沒有偵測到臉（${sec(cfg.windowMs)} 秒內都沒有）`)
  }

  const hand = s.hand
  if (hand.kind === 'untracked') {
    parts.push('未追蹤手部')
  } else if (hand.kind === 'absent') {
    parts.push('沒有偵測到手')
  } else {
    const { reversals, amplitude, spanMs } = hand.wave
    parts.push(
      reversals > 0
        ? `手腕在 ${sec(spanMs)} 秒內水平折返 ${reversals} 次，擺幅 ${amplitude.toFixed(2)}`
        : '手腕沒有水平折返',
    )
    const g = hand.gesture
    parts.push(g && g.name !== 'None' ? `目前手勢 ${g.name}（${g.score.toFixed(2)}）` : '沒有可辨識的手勢')
  }

  return parts.join('；')
}

export function serializeFacts(frames: readonly FrameFacts[], cfg: SerializerConfig = SERIALIZER_CONFIG): string | null {
  const summary = summarizeFacts(frames, cfg)
  return summary ? formatSummary(summary, cfg) : null
}

/** 保留最近 windowMs 的事實 */
export function createFactWindow(windowMs: number = SERIALIZER_CONFIG.windowMs) {
  let frames: FrameFacts[] = []
  return {
    push(f: FrameFacts): void {
      frames.push(f)
      const cutoff = f.t - windowMs
      if (frames[0] && frames[0].t < cutoff) frames = frames.filter((x) => x.t >= cutoff)
    },
    get frames(): readonly FrameFacts[] {
      return frames
    },
    clear(): void {
      frames = []
    },
  }
}
