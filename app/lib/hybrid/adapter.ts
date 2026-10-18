// Hybrid adapter：狀態機的修改全部集中在這裡，原本的 stepPresence 一行都沒動。
// 做法是「先讓規則照常算，再決定要不要採用它的結果」：
// - 規則想從 approaching 進 greeted 時，多一道 Jev 的關卡：P(想互動) 要過門檻
// - approaching 期間最多每秒問 Jev 一次，judge 還在忙就不問
// 唯一的耦合：擋下轉移時要知道 PresenceState 的 phase / phaseSince 兩個欄位。
import { PRESENCE_CONFIG, type PresenceConfig } from '../judgment/config'
import {
  initialPresence,
  stepPresence,
  type PresenceInput,
  type PresenceState,
  type PresenceTransition,
} from '../judgment/usePresenceStateMachine'
import type { JevVerdict } from './verdicts'

export interface HybridConfig {
  /** P(想互動) 達到這個值才放行進 greeted */
  intentThreshold: number
  /** approaching 期間兩次詢問的最小間隔 */
  askIntervalMs: number
  /** Jev 判斷的事實時間距今超過這個值就視為過期 */
  verdictMaxAgeMs: number
  /** 這段 approaching 開始後這麼久都沒拿到任何 Jev 判斷（服務掛了），退回純規則 */
  fallbackAfterMs: number
}

export const HYBRID_CONFIG: HybridConfig = {
  intentThreshold: 0.6,
  askIntervalMs: 1000,
  verdictMaxAgeMs: 2000,
  fallbackAfterMs: 5000,
}

export type GateDecision =
  | 'pass' // Jev 同意
  | 'block-low-intent' // Jev 認為只是路過
  | 'block-waiting' // 還沒有新鮮的 Jev 判斷，先等
  | 'fallback' // 一直拿不到 Jev 判斷，照規則放行

export interface HybridState {
  presence: PresenceState
  /** 這段 approaching 拿到的最新 Jev 判斷 */
  verdict: JevVerdict | null
  lastAskAt: number | null
  /** 最近一次規則想打招呼時，關卡的決定 */
  lastGate: GateDecision | null
}

export interface HybridStep {
  state: HybridState
  transitions: PresenceTransition[]
  /** 規則想進 greeted 時的關卡決定；這一幀沒有嘗試則為 null */
  gate: GateDecision | null
  /** 這一幀要不要發一個 Jev 請求 */
  ask: boolean
}

export function initialHybrid(t: number): HybridState {
  return { presence: initialPresence(t), verdict: null, lastAskAt: null, lastGate: null }
}

export function stepHybrid(
  s: HybridState,
  input: PresenceInput & { judgeBusy: boolean },
  cfg: HybridConfig = HYBRID_CONFIG,
  pcfg: PresenceConfig = PRESENCE_CONFIG,
): HybridStep {
  const { t } = input
  const next = stepPresence(s.presence, input, pcfg)
  let presence = next.state
  let transitions = next.transitions
  let gate: GateDecision | null = null

  if (transitions.some((tr) => tr.to === 'greeted')) {
    const episodeStart = s.presence.phaseSince
    const verdict = s.verdict && s.verdict.t >= episodeStart ? s.verdict : null
    const fresh = verdict !== null && t - verdict.t <= cfg.verdictMaxAgeMs

    if (fresh && verdict.engage >= cfg.intentThreshold) gate = 'pass'
    else if (fresh) gate = 'block-low-intent'
    else if (verdict === null && t - episodeStart >= cfg.fallbackAfterMs) gate = 'fallback'
    else gate = 'block-waiting'

    if (gate.startsWith('block')) {
      // 採用規則算出的其他欄位（臉寬比、最後在場時間），只把階段留在 approaching
      presence = { ...presence, phase: s.presence.phase, phaseSince: s.presence.phaseSince }
      transitions = transitions.filter((tr) => tr.to !== 'greeted')
    }
  }

  const approaching = presence.phase === 'approaching'
  const intervalOk = s.lastAskAt === null || t - s.lastAskAt >= cfg.askIntervalMs
  const ask = approaching && !input.judgeBusy && intervalOk

  return {
    state: {
      presence,
      // 離開 approaching 就丟掉這段的判斷，下一段重新問
      verdict: approaching ? s.verdict : null,
      lastAskAt: ask ? t : s.lastAskAt,
      lastGate: gate ?? s.lastGate,
    },
    transitions,
    gate,
    ask,
  }
}

/** Jev 回來後寫進 state；只收這段 approaching 開始之後的事實所做的判斷 */
export function acceptVerdict(s: HybridState, verdict: JevVerdict): HybridState {
  if (s.presence.phase !== 'approaching' || verdict.t < s.presence.phaseSince) return s
  if (s.verdict && s.verdict.t > verdict.t) return s
  return { ...s, verdict }
}
