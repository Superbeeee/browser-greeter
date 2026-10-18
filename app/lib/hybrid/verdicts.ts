// 同一批事實上的兩種判定：規則（手寫門檻）與 Jev（機率），題目一一對應，方便並列比較。
import type { AnswersFor } from '#shared/jev/protocol'
import type { MotionLabel } from '#shared/jev/questions'
import { PRESENCE_CONFIG, WAVE_CONFIG, type PresenceConfig, type WaveConfig } from '../judgment/config'
import type { PresenceState } from '../judgment/usePresenceStateMachine'
import type { FactSummary } from '../jev/fact-serializer'

export interface RuleVerdict {
  /** 規則沒有「想互動」的概念，只能用狀態機進度推：停留滿 dwell 才算 engage，之前是 pending */
  intent: 'engage' | 'pending' | 'passing'
  waving: boolean
  motion: MotionLabel
}

export interface JevVerdict {
  /** 這份判斷對應的事實時間 */
  t: number
  /** P(想互動) */
  engage: number
  /** P(正在揮手) */
  waving: number
  motion: MotionLabel
  motionProbs: Record<MotionLabel, number>
}

export function ruleVerdict(
  summary: FactSummary,
  presence: PresenceState,
  pcfg: PresenceConfig = PRESENCE_CONFIG,
  wcfg: WaveConfig = WAVE_CONFIG,
): RuleVerdict {
  let intent: RuleVerdict['intent'] = 'passing'
  if (presence.phase === 'greeted' || presence.phase === 'cooldown') intent = 'engage'
  else if (presence.phase === 'approaching') {
    intent = summary.t - presence.phaseSince >= pcfg.dwellMs ? 'engage' : 'pending'
  }

  const hand = summary.hand
  const waving =
    hand.kind === 'present' && hand.wave.reversals >= wcfg.minReversals && hand.wave.amplitude >= wcfg.minAmplitude

  let motion: MotionLabel = 'leaving'
  if (summary.face) {
    motion =
      summary.face.trend === 'growing' ? 'approaching' : summary.face.trend === 'shrinking' ? 'leaving' : 'staying'
  }

  return { intent, waving, motion }
}

export function jevVerdict(t: number, answers: AnswersFor<'hybrid'>): JevVerdict {
  return {
    t,
    engage: answers.intent.probabilities.engage,
    waving: answers.waving.noul,
    motion: answers.motion.choice,
    motionProbs: { ...answers.motion.probabilities },
  }
}

export interface Agreement {
  /** 規則還在 pending 時無從比較，記 null */
  intent: boolean | null
  waving: boolean
  motion: boolean
}

/** Jev 以 0.5 為界轉成二元，跟規則比 */
export function compareVerdicts(rule: RuleVerdict, jev: JevVerdict): Agreement {
  return {
    intent: rule.intent === 'pending' ? null : (rule.intent === 'engage') === jev.engage >= 0.5,
    waving: rule.waving === jev.waving >= 0.5,
    motion: rule.motion === jev.motion,
  }
}
