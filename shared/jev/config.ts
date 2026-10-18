// Jev 相關設定，前端與 server 共用。

/** 模型版本寫死，不用 jev-latest / jev-preview 這類會移動的別名 */
export const JEV_MODELS = {
  /** 文字題（Hybrid、校準實驗） */
  text: 'jev-1.13.0',
  /** 影像與 Box 題；文件建議 jev-preview，寫死成它目前指向的版本 */
  image: 'jev-1.14.0',
} as const

/** 費率（美元 / 百萬 token），來源：https://docs.typesafe.ai/models */
export const JEV_PRICING = {
  inputPerMTok: 0.042,
  /** output token 免費 */
  outputPerMTok: 0,
} as const

/** proxy 的請求限制 */
export const JEV_LIMITS = {
  /** 文字 state 最多幾個字元 */
  maxStateChars: 2000,
  /** 影像最大位元組數；384×288 的 JPEG 通常在 30KB 以內 */
  maxImageBytes: 200_000,
  /** Jev 拒收任一邊小於 280px 的影像（不會自動縮放），來源：https://docs.typesafe.ai/images */
  minImageSide: 280,
  /** 單一請求最多幾題 */
  maxQuestions: 5,
  /** 單次上游請求 timeout */
  timeoutMs: { text: 8000, image: 15000 },
} as const

export function costUsd(inputTokens: number | null, outputTokens: number | null): number {
  return (
    ((inputTokens ?? 0) * JEV_PRICING.inputPerMTok + (outputTokens ?? 0) * JEV_PRICING.outputPerMTok) /
    1_000_000
  )
}
