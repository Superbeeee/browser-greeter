// 數值統計：延遲、校準實驗共用

export interface Summary {
  n: number
  mean: number
  std: number
  min: number
  max: number
}

export function summarize(values: readonly number[]): Summary | null {
  const n = values.length
  if (n === 0) return null
  const mean = values.reduce((s, v) => s + v, 0) / n
  // 母體標準差：校準實驗是對同一份 state 的全部樣本
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
  return { n, mean, std, min: Math.min(...values), max: Math.max(...values) }
}

/** nearest-rank 百分位數，p 介於 0~100 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]!
}
