import { describe, expect, it } from 'vitest'
import { summarizeCalibration, type CalibrationSample } from '~/lib/jev/calibration'

function sample(engage: number, waving: number, latencyMs: number, inputTokens: number | null = 300): CalibrationSample {
  const staying = 0.7
  return {
    latencyMs,
    inputTokens,
    answers: {
      intent: {
        type: 'choice',
        choice: engage >= 0.5 ? 'engage' : 'passing',
        confidence: Math.abs(engage - 0.5) * 2,
        probabilities: { engage, passing: 1 - engage },
      },
      waving: { type: 'noul', noul: waving },
      motion: {
        type: 'choice',
        choice: 'staying',
        confidence: 0.6,
        probabilities: { approaching: 0.2, staying, leaving: 0.1 },
      },
    },
  }
}

describe('summarizeCalibration', () => {
  it('沒有樣本回傳 null', () => {
    expect(summarizeCalibration([])).toBeNull()
  })

  it('每題機率的平均、標準差、最小最大與選中次數', () => {
    const result = summarizeCalibration([sample(0.8, 0.1, 100), sample(0.6, 0.3, 200), sample(0.4, 0.2, 300)])!
    expect(result.n).toBe(3)
    expect(result.intent.probabilities.engage.mean).toBeCloseTo(0.6)
    expect(result.intent.probabilities.engage.min).toBe(0.4)
    expect(result.intent.probabilities.engage.max).toBe(0.8)
    expect(result.intent.probabilities.engage.std).toBeCloseTo(Math.sqrt(0.08 / 3))
    expect(result.intent.picks).toEqual({ engage: 2, passing: 1 })
    expect(result.waving.mean).toBeCloseTo(0.2)
    expect(result.motion.picks).toEqual({ approaching: 0, staying: 3, leaving: 0 })
    expect(result.motion.probabilities.staying.std).toBeCloseTo(0)
    expect(result.latency).toEqual({ mean: 200, p95: 300 })
  })

  it('token 為 null 的樣本不列入 token 統計', () => {
    const result = summarizeCalibration([sample(0.5, 0.5, 100, null), sample(0.5, 0.5, 100, 400)])!
    expect(result.inputTokens).toMatchObject({ n: 1, mean: 400 })
  })
})
