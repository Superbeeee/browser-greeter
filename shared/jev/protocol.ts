// 前端 ↔ proxy 之間的資料格式
import type { SystemOneResult } from '@typesafe-ai/sdk'
import type { QUESTION_SETS, QuestionSetId } from './questions'

export type AnswersFor<S extends QuestionSetId> = SystemOneResult<(typeof QUESTION_SETS)[S]>['answers']

export interface JevUsage {
  inputTokens: number | null
  outputTokens: number | null
}

export interface JevProxyResponse<S extends QuestionSetId> {
  set: S
  model: string
  answers: AnswersFor<S>
  usage: JevUsage
  /** proxy 到 TypeSafe 的往返時間（不含瀏覽器到 proxy） */
  upstreamMs: number
}

/** 文字題組用 JSON 送出 */
export interface JevTextRequest {
  set: 'hybrid'
  state: string
}

/** 影像題組用 multipart 送出，欄位名稱 */
export const IMAGE_FORM_FIELDS = { set: 'set', image: 'image' } as const
