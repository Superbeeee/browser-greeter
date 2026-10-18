// 判定層：把逐幀的臉部事實轉成「有人靠近、打招呼、離開」的行為事件。
// 純邏輯，不依賴 MediaPipe 與 Vue；時間由外部注入。
import type { FrameFacts } from '../perception/types'
import { PRESENCE_CONFIG, type PresenceConfig } from './config'

export type PresencePhase = 'idle' | 'approaching' | 'greeted' | 'cooldown'

export type TransitionReason =
  | 'near' // 臉寬比達到 enterRatio
  | 'dwell' // approaching 持續滿 dwellMs
  | 'too-far' // approaching 中臉寬比掉到 exitRatio 以下
  | 'face-lost' // approaching 中臉消失超過寬限
  | 'hold-elapsed' // greeted 顯示完畢
  | 'away' // cooldown 中人離開滿 absentMs

export interface PresenceTransition {
  from: PresencePhase
  to: PresencePhase
  reason: TransitionReason
  t: number
}

export interface PresenceState {
  phase: PresencePhase
  /** 進入目前 phase 的時間 */
  phaseSince: number
  /** 最近一次「人在近處」（有臉且臉寬比 ≥ exitRatio）的時間 */
  lastNearAt: number | null
  /** 最近一幀的臉寬比，沒有臉時為 null */
  ratio: number | null
}

export type PresenceInput = Pick<FrameFacts, 't' | 'face'>

export interface PresenceStep {
  state: PresenceState
  transitions: PresenceTransition[]
}

export function initialPresence(t: number): PresenceState {
  return { phase: 'idle', phaseSince: t, lastNearAt: null, ratio: null }
}

export function stepPresence(
  s: PresenceState,
  input: PresenceInput,
  cfg: PresenceConfig = PRESENCE_CONFIG,
): PresenceStep {
  const { t, face } = input
  const ratio = face?.widthRatio ?? null
  const near = ratio !== null && ratio >= cfg.exitRatio
  const lastNearAt = near ? t : s.lastNearAt
  const base: PresenceState = { ...s, ratio, lastNearAt }

  const go = (to: PresencePhase, reason: TransitionReason): PresenceStep => ({
    state: { ...base, phase: to, phaseSince: t },
    transitions: [{ from: s.phase, to, reason, t }],
  })
  const stay: PresenceStep = { state: base, transitions: [] }

  switch (s.phase) {
    case 'idle':
      return ratio !== null && ratio >= cfg.enterRatio ? go('approaching', 'near') : stay

    case 'approaching':
      if (face === null) {
        // 掉幀寬限內維持原狀，dwell 計時不中斷
        const lostFor = t - (s.lastNearAt ?? s.phaseSince)
        return lostFor > cfg.faceLostGraceMs ? go('idle', 'face-lost') : stay
      }
      if (!near) return go('idle', 'too-far')
      return t - s.phaseSince >= cfg.dwellMs ? go('greeted', 'dwell') : stay

    case 'greeted':
      return t - s.phaseSince >= cfg.greetHoldMs ? go('cooldown', 'hold-elapsed') : stay

    case 'cooldown': {
      // 冷卻期至少 absentMs；同一個人一直待著就一直冷卻，不會被重複問候
      const awaySince = Math.max(s.lastNearAt ?? s.phaseSince, s.phaseSince)
      return !near && t - awaySince >= cfg.absentMs ? go('idle', 'away') : stay
    }
  }
}

/** 包一層可變的外殼，方便在迴圈裡逐幀呼叫；核心仍是上面的純函式 */
export function usePresenceStateMachine(cfg: PresenceConfig = PRESENCE_CONFIG, t0 = 0) {
  let state = initialPresence(t0)
  return {
    get state(): PresenceState {
      return state
    },
    update(input: PresenceInput): PresenceTransition[] {
      const next = stepPresence(state, input, cfg)
      state = next.state
      return next.transitions
    },
    reset(t: number): void {
      state = initialPresence(t)
    },
  }
}
