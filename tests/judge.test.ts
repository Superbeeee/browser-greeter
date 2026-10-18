import { describe, expect, it } from 'vitest'
import type { JevProxyResponse } from '#shared/jev/protocol'
import { createJevJudge } from '~/lib/jev/judge'
import { percentile, summarize } from '~/lib/jev/stats'

function response(inputTokens: number | null = 400): JevProxyResponse<'hybrid'> {
  return {
    set: 'hybrid',
    model: 'jev-1.13.0',
    answers: {
      intent: { type: 'choice', choice: 'engage', confidence: 0.8, probabilities: { engage: 0.9, passing: 0.1 } },
      waving: { type: 'noul', noul: 0.2 },
      motion: {
        type: 'choice',
        choice: 'staying',
        confidence: 0.7,
        probabilities: { approaching: 0.1, staying: 0.8, leaving: 0.1 },
      },
    },
    usage: { inputTokens, outputTokens: 20 },
    upstreamMs: 100,
  }
}

/** 可以手動決定何時回應的假 transport */
function deferredSend() {
  const pending: Array<{ resolve: (r: JevProxyResponse<'hybrid'>) => void; reject: (e: Error) => void }> = []
  const send = (_: string) =>
    new Promise<JevProxyResponse<'hybrid'>>((resolve, reject) => pending.push({ resolve, reject }))
  return { send, pending }
}

function fakeClock() {
  let t = 0
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

describe('createJevJudge', () => {
  it('前一個請求沒回來時跳過，不堆積', async () => {
    const { send, pending } = deferredSend()
    const judge = createJevJudge({ set: 'hybrid', send, describe: (s: string) => s })
    const first = judge.ask('a')
    expect(judge.busy).toBe(true)
    expect(await judge.ask('b')).toBeNull()
    expect(pending.length).toBe(1)
    pending[0]!.resolve(response())
    await first
    expect(judge.busy).toBe(false)
    expect(judge.stats()).toMatchObject({ calls: 1, skipped: 1 })
  })

  it('記錄延遲、token 與成本', async () => {
    const clock = fakeClock()
    const { send, pending } = deferredSend()
    const judge = createJevJudge({ set: 'hybrid', send, describe: (s: string) => s, now: clock.now })
    const p = judge.ask('臉寬比 0.30', 42)
    clock.advance(250)
    pending[0]!.resolve(response(1_000_000))
    const record = (await p)!
    expect(record).toMatchObject({
      t: 42,
      state: '臉寬比 0.30',
      latencyMs: 250,
      upstreamMs: 100,
      inputTokens: 1_000_000,
      model: 'jev-1.13.0',
      error: null,
    })
    expect(record.costUsd).toBeCloseTo(0.042)
  })

  it('usage 為 null 時成本記 0', async () => {
    const judge = createJevJudge({ set: 'hybrid', send: async () => response(null), describe: (s: string) => s })
    expect((await judge.ask('x'))!.costUsd).toBe(0)
  })

  it('失敗會記錄錯誤並釋放 busy，不計入延遲統計', async () => {
    const clock = fakeClock()
    let fail = true
    const judge = createJevJudge({
      set: 'hybrid',
      now: clock.now,
      describe: (s: string) => s,
      send: async () => {
        clock.advance(fail ? 5000 : 200)
        if (fail) throw new Error('HTTP 502 Upstream 500')
        return response()
      },
    })
    const failed = await judge.ask('x')
    expect(failed?.error).toBe('HTTP 502 Upstream 500')
    expect(judge.busy).toBe(false)
    fail = false
    await judge.ask('y')
    expect(judge.stats()).toMatchObject({ calls: 2, failures: 1, meanMs: 200, p95Ms: 200, inputTokens: 400 })
  })

  it('匯出的 JSON 有模型、費率、統計與紀錄', async () => {
    const judge = createJevJudge({ set: 'hybrid', send: async () => response(), describe: (s: string) => s })
    await judge.ask('x')
    const data = judge.exportData()
    expect(data.models.text).toBe('jev-1.13.0')
    expect(data.pricing.inputPerMTok).toBe(0.042)
    expect(data.records).toHaveLength(1)
    expect(JSON.parse(JSON.stringify(data)).records[0].state).toBe('x')
  })

  it('影像請求不保存 state', async () => {
    const judge = createJevJudge({ set: 'hybrid', send: async () => response(), describe: () => null })
    expect((await judge.ask(new Uint8Array([1, 2, 3])))!.state).toBeNull()
  })
})

describe('stats', () => {
  it('summarize 回傳平均、母體標準差、最小最大', () => {
    expect(summarize([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ n: 8, mean: 5, std: 2, min: 2, max: 9 })
    expect(summarize([])).toBeNull()
  })

  it('percentile 用 nearest-rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(values, 95)).toBe(95)
    expect(percentile([300, 100, 200], 95)).toBe(300)
    expect(percentile([5], 95)).toBe(5)
    expect(percentile([], 95)).toBeNull()
  })
})
