// JevJudge：一次只允許一個請求在途，前一個沒回來就跳過，不堆積。
// 每次請求記錄延遲、token、成本，可匯出 JSON。
// 匯出內容只有文字 state 與答案：影像不保存，API key 從頭到尾不經過前端。
import { costUsd, JEV_MODELS, JEV_PRICING } from '#shared/jev/config'
import type { AnswersFor, JevProxyResponse } from '#shared/jev/protocol'
import type { QuestionSetId } from '#shared/jev/questions'
import { percentile, summarize } from './stats'

export interface JevRecord<S extends QuestionSetId> {
  id: number
  set: S
  /** 牆上時間，方便對照錄影 */
  startedAt: string
  /** state 對應的事實時間（performance.now()） */
  t: number
  /** 文字 state；影像請求為 null，影像本身不保存 */
  state: string | null
  /** 瀏覽器端量到的總延遲 */
  latencyMs: number
  /** proxy 到 TypeSafe 的往返時間 */
  upstreamMs: number | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number
  answers: AnswersFor<S> | null
  error: string | null
}

export interface JevStats {
  calls: number
  failures: number
  /** 因為前一個請求還沒回來而跳過的次數 */
  skipped: number
  meanMs: number | null
  p95Ms: number | null
  inputTokens: number
  costUsd: number
}

export interface JevJudgeOptions<S extends QuestionSetId, I> {
  set: S
  send: (input: I) => Promise<JevProxyResponse<S>>
  /** 轉成要記錄的文字 state；影像回傳 null */
  describe: (input: I) => string | null
  now?: () => number
  clock?: () => number
  /** 最多保留幾筆紀錄 */
  maxRecords?: number
  onChange?: () => void
}

export function createJevJudge<S extends QuestionSetId, I>(opts: JevJudgeOptions<S, I>) {
  const { set, send, describe, now = () => performance.now(), clock = () => Date.now(), maxRecords = 1000 } = opts
  let records: JevRecord<S>[] = []
  let busy = false
  let skipped = 0
  let nextId = 1

  const changed = () => opts.onChange?.()

  async function ask(input: I, t: number = now()): Promise<JevRecord<S> | null> {
    if (busy) {
      skipped++
      changed()
      return null
    }
    busy = true
    changed()
    const started = now()
    const base = { id: nextId++, set, startedAt: new Date(clock()).toISOString(), t, state: describe(input) }
    let record: JevRecord<S>
    try {
      const res = await send(input)
      record = {
        ...base,
        latencyMs: now() - started,
        upstreamMs: res.upstreamMs,
        model: res.model,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        costUsd: costUsd(res.usage.inputTokens, res.usage.outputTokens),
        answers: res.answers,
        error: null,
      }
    } catch (err) {
      record = {
        ...base,
        latencyMs: now() - started,
        upstreamMs: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: 0,
        answers: null,
        error: err instanceof Error ? err.message : String(err),
      }
    } finally {
      busy = false
    }
    records = [...records, record].slice(-maxRecords)
    changed()
    return record
  }

  function stats(): JevStats {
    const ok = records.filter((r) => r.error === null)
    const latencies = ok.map((r) => r.latencyMs)
    return {
      calls: records.length,
      failures: records.length - ok.length,
      skipped,
      meanMs: summarize(latencies)?.mean ?? null,
      p95Ms: percentile(latencies, 95),
      inputTokens: ok.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
      costUsd: ok.reduce((s, r) => s + r.costUsd, 0),
    }
  }

  function exportData() {
    return {
      exportedAt: new Date(clock()).toISOString(),
      set,
      models: JEV_MODELS,
      pricing: JEV_PRICING,
      stats: stats(),
      records,
    }
  }

  function reset(): void {
    records = []
    skipped = 0
    changed()
  }

  return {
    get busy() {
      return busy
    },
    get records(): readonly JevRecord<S>[] {
      return records
    },
    ask,
    stats,
    exportData,
    reset,
  }
}

export type JevJudge<S extends QuestionSetId, I> = ReturnType<typeof createJevJudge<S, I>>
