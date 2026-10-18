import { describe, expect, it } from 'vitest'
import { initialGate, passGate, type GateState } from '~/lib/loop/frame-gate'
import { createRateMeter } from '~/lib/loop/rate-meter'

/** 模擬 60Hz rAF 跑 durationMs，影片以 videoFps 前進，回傳實際推論的時間點 */
function simulate(fps: number, durationMs: number, videoFps = 30): number[] {
  let gate: GateState = initialGate()
  const runs: number[] = []
  for (let now = 0; now <= durationMs; now += 1000 / 60) {
    const videoTime = Math.floor((now / 1000) * videoFps) / videoFps
    const result = passGate(gate, { now, videoTime, fps })
    gate = result.gate
    if (result.run) runs.push(now)
  }
  return runs
}

describe('passGate', () => {
  it('第一幀一定推論', () => {
    expect(passGate(initialGate(), { now: 0, videoTime: 0, fps: 8 }).run).toBe(true)
  })

  it('8fps 節流：一秒約 8 次推論', () => {
    expect(simulate(8, 1000).length).toBeGreaterThanOrEqual(7)
    expect(simulate(8, 1000).length).toBeLessThanOrEqual(9)
  })

  it('12fps 比 8fps 推論更多次', () => {
    expect(simulate(12, 2000).length).toBeGreaterThan(simulate(8, 2000).length)
  })

  it('影片沒有前進時不重算同一幀', () => {
    const gate: GateState = { lastRunAt: 0, lastVideoTime: 1.5 }
    const result = passGate(gate, { now: 500, videoTime: 1.5, fps: 8 })
    expect(result).toMatchObject({ run: false, skipped: 'same-frame' })
  })

  it('鏡頭只有 5fps 時，推論頻率被影片幀率限制', () => {
    expect(simulate(12, 2000, 5).length).toBeLessThanOrEqual(11)
  })

  it('推論 timestamp 嚴格遞增', () => {
    const runs = simulate(60, 2000)
    for (let i = 1; i < runs.length; i++) expect(runs[i]!).toBeGreaterThan(runs[i - 1]!)
  })

  it('時間倒退或重複時跳過', () => {
    const gate: GateState = { lastRunAt: 1000, lastVideoTime: 1 }
    expect(passGate(gate, { now: 1000, videoTime: 2, fps: 1e9 }).run).toBe(false)
    expect(passGate(gate, { now: 900, videoTime: 2, fps: 1e9 }).run).toBe(false)
  })
})

describe('createRateMeter', () => {
  it('回報最近一秒內的次數', () => {
    const meter = createRateMeter(1000)
    for (let t = 0; t < 1000; t += 125) meter.tick(t)
    expect(meter.rate(999)).toBe(8)
    expect(meter.rate(1600)).toBe(3)
  })
})
