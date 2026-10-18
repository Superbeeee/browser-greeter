import { describe, expect, it } from 'vitest'
import type { PresenceConfig } from '~/lib/judgment/config'
import {
  acceptVerdict,
  initialHybrid,
  stepHybrid,
  type HybridConfig,
  type HybridState,
  type GateDecision,
} from '~/lib/hybrid/adapter'
import { compareVerdicts, ruleVerdict, type JevVerdict } from '~/lib/hybrid/verdicts'
import type { FactSummary } from '~/lib/jev/fact-serializer'
import type { FaceFact } from '~/lib/perception/types'
import { face, frames } from './helpers/facts'

const pcfg: PresenceConfig = {
  enterRatio: 0.22,
  exitRatio: 0.17,
  dwellMs: 1000,
  greetHoldMs: 2000,
  absentMs: 1500,
  faceLostGraceMs: 400,
}
const cfg: HybridConfig = { intentThreshold: 0.6, askIntervalMs: 1000, verdictMaxAgeMs: 2000, fallbackAfterMs: 5000 }

function verdict(t: number, engage: number): JevVerdict {
  return { t, engage, waving: 0.1, motion: 'staying', motionProbs: { approaching: 0.1, staying: 0.8, leaving: 0.1 } }
}

function run(s: HybridState, ts: number[], f: FaceFact | null, busy = false) {
  const asks: number[] = []
  const gates: GateDecision[] = []
  const phases: string[] = []
  for (const t of ts) {
    const next = stepHybrid(s, { t, face: f, judgeBusy: busy }, cfg, pcfg)
    s = next.state
    if (next.ask) asks.push(t)
    if (next.gate) gates.push(next.gate)
    phases.push(...next.transitions.map((tr) => tr.to))
  }
  return { state: s, asks, gates, phases }
}

/** 進入 approaching 並拿到一份判斷 */
function approachingWith(engage: number | null, t0 = 0): HybridState {
  let s = run(initialHybrid(t0), [t0], face(0.3)).state
  if (engage !== null) s = acceptVerdict(s, verdict(t0 + 200, engage))
  return s
}

describe('stepHybrid', () => {
  it('Jev 判定想互動：dwell 滿就進 greeted', () => {
    const { state, gates, phases } = run(approachingWith(0.9), frames(125, 875, 8), face(0.3))
    expect(gates).toEqual(['pass'])
    expect(phases).toEqual(['greeted'])
    expect(state.presence.phase).toBe('greeted')
  })

  it('Jev 判定只是路過：規則想打招呼也被擋下', () => {
    const { state, gates, phases } = run(approachingWith(0.2), frames(125, 1375, 8), face(0.3))
    expect(phases).toEqual([])
    expect(gates.every((g) => g === 'block-low-intent')).toBe(true)
    expect(state.presence.phase).toBe('approaching')
    // dwell 計時保留，Jev 改口後下一幀就能進 greeted
    const later = acceptVerdict(state, verdict(1400, 0.8))
    expect(run(later, [1500], face(0.3)).phases).toEqual(['greeted'])
  })

  it('還沒拿到 Jev 判斷時先等', () => {
    const { gates, state } = run(approachingWith(null), frames(125, 1375, 8), face(0.3))
    expect(gates.every((g) => g === 'block-waiting')).toBe(true)
    expect(state.presence.phase).toBe('approaching')
  })

  it('判斷過期也要等新的', () => {
    // t=200 的「路過」判斷擋住問候，之後 judge 一直忙、拿不到新判斷；超過 2 秒就視為過期
    const { gates } = run(approachingWith(0.2), frames(125, 3000, 8), face(0.3), true)
    expect(gates[0]).toBe('block-low-intent')
    expect(gates.at(-1)).toBe('block-waiting')
  })

  it('一直拿不到 Jev 判斷就退回純規則', () => {
    const { gates, phases } = run(approachingWith(null), frames(125, 5000, 8), face(0.3))
    expect(gates.at(-1)).toBe('fallback')
    expect(phases).toEqual(['greeted'])
  })

  it('被擋下時仍沿用規則的其他判斷：人離開照樣回 idle', () => {
    const s = run(approachingWith(0.2), frames(125, 1375, 8), face(0.3)).state
    const { phases, state } = run(s, [1625], face(0.1))
    expect(phases).toEqual(['idle'])
    expect(state.verdict).toBeNull()
  })

  it('approaching 期間最多每秒問一次', () => {
    // 沒有 Jev 判斷，會一直停在 approaching（直到 5 秒 fallback）
    const { asks } = run(initialHybrid(0), frames(0, 2500, 8), face(0.3))
    expect(asks).toEqual([0, 1000, 2000])
  })

  it('judge 忙碌時不問，空下來立刻問', () => {
    const s = run(initialHybrid(0), [0], face(0.3), true).state
    expect(s.lastAskAt).toBeNull()
    const next = stepHybrid(s, { t: 125, face: face(0.3), judgeBusy: false }, cfg, pcfg)
    expect(next.ask).toBe(true)
  })

  it('idle 與 cooldown 時不問', () => {
    expect(run(initialHybrid(0), frames(0, 2000, 8), face(0.1)).asks).toEqual([])
  })
})

describe('acceptVerdict', () => {
  it('不收這段 approaching 之前的事實所做的判斷', () => {
    const s = approachingWith(null, 1000)
    expect(acceptVerdict(s, verdict(900, 0.9)).verdict).toBeNull()
  })

  it('不讓晚回來的舊判斷蓋掉新判斷', () => {
    const s = acceptVerdict(approachingWith(null), verdict(800, 0.9))
    expect(acceptVerdict(s, verdict(500, 0.1)).verdict?.engage).toBe(0.9)
  })

  it('不在 approaching 時忽略', () => {
    expect(acceptVerdict(initialHybrid(0), verdict(100, 0.9)).verdict).toBeNull()
  })
})

describe('ruleVerdict / compareVerdicts', () => {
  const summary = (over: Partial<FactSummary> = {}): FactSummary => ({
    t: 2000,
    face: { ratio: 0.3, presentMs: 1500, presentCapped: false, trend: 'growing' },
    faceGoneMs: null,
    hand: { kind: 'present', wave: { reversals: 3, amplitude: 0.15, spanMs: 800 }, gesture: null },
    ...over,
  })
  const approaching = { phase: 'approaching' as const, phaseSince: 1500, lastNearAt: 2000, ratio: 0.3 }

  it('規則的三題答案', () => {
    expect(ruleVerdict(summary(), approaching, pcfg)).toEqual({ intent: 'pending', waving: true, motion: 'approaching' })
    expect(ruleVerdict(summary(), { ...approaching, phaseSince: 500 }, pcfg).intent).toBe('engage')
    expect(ruleVerdict(summary({ face: null }), { ...approaching, phase: 'idle' }, pcfg)).toMatchObject({
      intent: 'passing',
      motion: 'leaving',
    })
  })

  it('Jev 以 0.5 為界與規則比較；規則 pending 時 intent 不比', () => {
    const rule = ruleVerdict(summary(), approaching, pcfg)
    expect(compareVerdicts(rule, { ...verdict(0, 0.9), waving: 0.3, motion: 'approaching' })).toEqual({
      intent: null,
      waving: false,
      motion: true,
    })
  })
})
