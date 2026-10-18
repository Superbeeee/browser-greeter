import { describe, expect, it } from 'vitest'
import type { WaveConfig } from '~/lib/judgment/config'
import { initialWave, stepWave, useWaveDetector, type WaveState } from '~/lib/judgment/useWaveDetector'
import { frames, hand } from './helpers/facts'

const cfg: WaveConfig = {
  windowMs: 1200,
  minReversals: 3,
  minAmplitude: 0.08,
  deadband: 0.02,
  dropoutGraceMs: 400,
  refractoryMs: 1500,
}

/** 以正弦波模擬左右揮手，回傳每幀是否判定為揮手 */
function swing(
  ts: number[],
  opts: { center?: number; amplitude: number; periodMs: number; mirror?: boolean },
  s: WaveState = initialWave(),
  config: WaveConfig = cfg,
) {
  const { center = 0.5, amplitude, periodMs, mirror = false } = opts
  const waves: number[] = []
  for (const t of ts) {
    const offset = (amplitude / 2) * Math.sin((2 * Math.PI * t) / periodMs)
    const x = center + (mirror ? -offset : offset)
    const next = stepWave(s, { t, hand: hand(x) }, config)
    s = next.state
    if (next.wave) waves.push(t)
  }
  return { state: s, waves }
}

describe('stepWave', () => {
  it('正常揮手（擺幅 0.15、週期 600ms、12fps）會被判定', () => {
    const { waves } = swing(frames(0, 1200, 12), { amplitude: 0.15, periodMs: 600 })
    expect(waves.length).toBe(1)
  })

  it('擺幅太小不算揮手', () => {
    const { waves } = swing(frames(0, 3000, 12), { amplitude: 0.05, periodMs: 600 })
    expect(waves).toEqual([])
  })

  it('動作太慢（視窗內折返不夠多）不算揮手', () => {
    const { waves } = swing(frames(0, 4000, 12), { amplitude: 0.2, periodMs: 2400 })
    expect(waves).toEqual([])
  })

  it('小於 deadband 的抖動不算折返', () => {
    let s = initialWave()
    for (const [i, t] of frames(0, 2000, 12).entries()) {
      s = stepWave(s, { t, hand: hand(0.5 + (i % 2 ? 0.008 : -0.008)) }, cfg).state
    }
    expect(s.extremes).toEqual([])
  })

  it('鏡像不影響結果', () => {
    const ts = frames(0, 1200, 12)
    const normal = swing(ts, { amplitude: 0.15, periodMs: 600 })
    const mirrored = swing(ts, { amplitude: 0.15, periodMs: 600, mirror: true })
    expect(mirrored.waves).toEqual(normal.waves)
  })

  it('不反應期內不重複觸發', () => {
    const { waves } = swing(frames(0, 3000, 12), { amplitude: 0.15, periodMs: 600 })
    expect(waves.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < waves.length; i++) {
      expect(waves[i]! - waves[i - 1]!).toBeGreaterThanOrEqual(cfg.refractoryMs)
    }
  })

  it('掉幀在 400ms 寬限內保留軌跡', () => {
    const half = swing(frames(0, 500, 12), { amplitude: 0.15, periodMs: 600 })
    const kept = stepWave(half.state, { t: 800, hand: null }, cfg).state
    expect(kept.extremes.length).toBe(half.state.extremes.length)
    expect(kept.extremes.length).toBeGreaterThan(0)
  })

  it('掉幀超過寬限就清掉軌跡', () => {
    const half = swing(frames(0, 500, 12), { amplitude: 0.15, periodMs: 600 })
    const cleared = stepWave(half.state, { t: 1000, hand: null }, cfg).state
    expect(cleared.extremes).toEqual([])
    expect(cleared.peak).toBeNull()
  })

  it('手在寬限外重新出現時，不沿用舊軌跡', () => {
    const half = swing(frames(0, 500, 12), { amplitude: 0.15, periodMs: 600 })
    const next = stepWave(half.state, { t: 1500, hand: hand(0.9) }, cfg)
    expect(next.state.extremes).toEqual([])
    expect(next.metrics.reversals).toBe(0)
  })

  it('metrics 回報視窗內的折返次數、擺幅與時間跨度', () => {
    // 調高門檻避免觸發揮手後清掉軌跡
    const neverFire = { ...cfg, minReversals: 99 }
    const { state } = swing(frames(0, 900, 12), { amplitude: 0.2, periodMs: 600 }, initialWave(), neverFire)
    const { metrics } = stepWave(state, { t: 1000, hand: hand(0.5) }, neverFire)
    expect(metrics.reversals).toBeGreaterThanOrEqual(2)
    expect(metrics.amplitude).toBeGreaterThan(0.15)
    expect(metrics.amplitude).toBeLessThanOrEqual(0.2 + 1e-9)
    expect(metrics.spanMs).toBeGreaterThan(0)
  })
})

describe('useWaveDetector', () => {
  it('逐幀 update 會回報揮手並保留最新 metrics', () => {
    const detector = useWaveDetector(cfg)
    let waved = false
    for (const t of frames(0, 1200, 12)) {
      const x = 0.5 + 0.075 * Math.sin((2 * Math.PI * t) / 600)
      waved ||= detector.update({ t, hand: hand(x) })
    }
    expect(waved).toBe(true)
    expect(detector.metrics.reversals).toBeGreaterThanOrEqual(3)
  })
})
