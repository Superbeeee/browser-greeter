// 校準實驗：對同一份凍結的 state 連續問 N 次，看每題機率的分布有多穩定。
import { INTENT_LABELS, MOTION_LABELS, type IntentLabel, type MotionLabel } from '#shared/jev/questions'
import type { AnswersFor } from '#shared/jev/protocol'
import { percentile, summarize, type Summary } from './stats'

export interface CalibrationSample {
  answers: AnswersFor<'hybrid'>
  latencyMs: number
  inputTokens: number | null
}

export interface CalibrationResult {
  n: number
  intent: {
    probabilities: Record<IntentLabel, Summary>
    /** 各選項被選為最高機率的次數 */
    picks: Record<IntentLabel, number>
  }
  waving: Summary
  motion: {
    probabilities: Record<MotionLabel, Summary>
    picks: Record<MotionLabel, number>
  }
  latency: { mean: number; p95: number }
  inputTokens: Summary | null
}

function summarizeChoice<L extends string>(
  labels: readonly L[],
  samples: readonly CalibrationSample[],
  pick: (a: AnswersFor<'hybrid'>) => { choice: L; probabilities: Readonly<Record<L, number>> },
) {
  const probabilities = {} as Record<L, Summary>
  const picks = {} as Record<L, number>
  for (const label of labels) {
    probabilities[label] = summarize(samples.map((s) => pick(s.answers).probabilities[label]))!
    picks[label] = samples.filter((s) => pick(s.answers).choice === label).length
  }
  return { probabilities, picks }
}

export function summarizeCalibration(samples: readonly CalibrationSample[]): CalibrationResult | null {
  if (samples.length === 0) return null
  const latencies = samples.map((s) => s.latencyMs)
  const tokens = samples.flatMap((s) => (s.inputTokens === null ? [] : [s.inputTokens]))
  return {
    n: samples.length,
    intent: summarizeChoice(INTENT_LABELS, samples, (a) => a.intent),
    waving: summarize(samples.map((s) => s.answers.waving.noul))!,
    motion: summarizeChoice(MOTION_LABELS, samples, (a) => a.motion),
    latency: { mean: summarize(latencies)!.mean, p95: percentile(latencies, 95)! },
    inputTokens: summarize(tokens),
  }
}
