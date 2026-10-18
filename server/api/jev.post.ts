// Jev proxy：只轉發 System One 這一個 endpoint。
// 前端只能選題組並提供 state（文字或一張 JPEG），題目、題數、模型都由這裡決定。
// API key 只在這裡讀取；log 只記題組、狀態碼、延遲與 token 數，不記 state、影像與 key。
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  TypeSafeClient,
  image,
  type RequestOptions,
} from '@typesafe-ai/sdk'
import { JEV_LIMITS, JEV_MODELS } from '#shared/jev/config'
import { IMAGE_FORM_FIELDS, type JevProxyResponse } from '#shared/jev/protocol'
import { QUESTION_SETS, type QuestionSetId } from '#shared/jev/questions'

let client: TypeSafeClient | null = null

function getClient(): TypeSafeClient {
  if (client) return client
  const apiKey = process.env.TYPESAFE_API_KEY?.trim()
  if (!apiKey) {
    throw createError({ statusCode: 503, statusMessage: 'TYPESAFE_API_KEY is not set' })
  }
  client = new TypeSafeClient({
    apiKey,
    // debug 等級會把請求內容（含影像、state）原樣印出，這裡完全關掉，自己記去敏摘要
    logLevel: 'off',
    // 不自動重試：量到的延遲才是單次請求的真實值，失敗就交給前端跳過這一輪
    retry: { maxRetries: 0 },
  })
  return client
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff]

interface Parsed {
  set: QuestionSetId
  state: string | ReturnType<typeof image>
}

async function parseRequest(event: InstanceType<typeof H3Event>): Promise<Parsed> {
  const length = Number(getRequestHeader(event, 'content-length'))
  if (!Number.isFinite(length)) throw createError({ statusCode: 411, statusMessage: 'Content-Length required' })
  // 影像加上 multipart 邊界的額外空間；文字請求遠小於這個值
  if (length > JEV_LIMITS.maxImageBytes + 4096) {
    throw createError({ statusCode: 413, statusMessage: 'Request too large' })
  }

  const contentType = getRequestHeader(event, 'content-type') ?? ''
  if (contentType.startsWith('application/json')) {
    const body = await readBody<unknown>(event)
    if (typeof body !== 'object' || body === null) throw badRequest('Invalid body')
    const { set, state } = body as Record<string, unknown>
    if (set !== 'hybrid') throw badRequest('Unknown question set')
    if (typeof state !== 'string' || state.trim() === '') throw badRequest('State must be a non-empty string')
    if (state.length > JEV_LIMITS.maxStateChars) {
      throw createError({ statusCode: 413, statusMessage: 'State too long' })
    }
    return { set, state }
  }

  if (contentType.startsWith('multipart/form-data')) {
    const parts = (await readMultipartFormData(event)) ?? []
    const set = parts.find((p) => p.name === IMAGE_FORM_FIELDS.set)?.data.toString('utf8')
    const file = parts.find((p) => p.name === IMAGE_FORM_FIELDS.image)?.data
    if (set !== 'image') throw badRequest('Unknown question set')
    if (!file || file.length === 0) throw badRequest('Image is required')
    if (file.length > JEV_LIMITS.maxImageBytes) {
      throw createError({ statusCode: 413, statusMessage: 'Image too large' })
    }
    if (!JPEG_MAGIC.every((byte, i) => file[i] === byte)) throw badRequest('Image must be JPEG')
    return { set, state: image(new Uint8Array(file)) }
  }

  throw createError({ statusCode: 415, statusMessage: 'Unsupported content type' })
}

function badRequest(statusMessage: string) {
  return createError({ statusCode: 400, statusMessage })
}

export default defineEventHandler(async (event): Promise<JevProxyResponse<QuestionSetId>> => {
  const { set, state } = await parseRequest(event)
  const questions = QUESTION_SETS[set]
  if (Object.keys(questions).length > JEV_LIMITS.maxQuestions) {
    throw createError({ statusCode: 500, statusMessage: 'Question set exceeds limit' })
  }

  const isImage = set === 'image'
  const options: RequestOptions = {
    timeout: isImage ? JEV_LIMITS.timeoutMs.image : JEV_LIMITS.timeoutMs.text,
    // 影像輸入是實驗性功能，要明確 opt-in
    headers: isImage ? { 'TypeSafe-Danger-Zone-Images': 'true' } : {},
  }

  const jev = getClient()
  const started = performance.now()
  try {
    const result = await jev.systemOne(
      { state, questions, model: isImage ? JEV_MODELS.image : JEV_MODELS.text },
      options,
    )
    const upstreamMs = Math.round(performance.now() - started)
    const usage = { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens }
    console.info(`[jev] ${set} 200 ${upstreamMs}ms in=${usage.inputTokens ?? '?'} out=${usage.outputTokens ?? '?'}`)
    return { set, model: result.model, answers: result.answers, usage, upstreamMs }
  } catch (err) {
    const ms = Math.round(performance.now() - started)
    // 只記狀態碼與類別，不記錯誤 body（可能回顯請求內容）
    if (err instanceof APIError) {
      console.warn(`[jev] ${set} upstream ${err.status} ${ms}ms request=${err.requestId ?? '-'}`)
      throw createError({
        statusCode: err.status === 429 ? 429 : 502,
        statusMessage: `Upstream ${err.status}`,
      })
    }
    if (err instanceof APITimeoutError) {
      console.warn(`[jev] ${set} timeout ${ms}ms`)
      throw createError({ statusCode: 504, statusMessage: 'Upstream timeout' })
    }
    if (err instanceof APIConnectionError) {
      console.warn(`[jev] ${set} connection error ${ms}ms`)
      throw createError({ statusCode: 502, statusMessage: 'Upstream connection error' })
    }
    console.warn(`[jev] ${set} failed ${ms}ms ${err instanceof Error ? err.name : 'unknown'}`)
    throw createError({ statusCode: 500, statusMessage: 'Jev request failed' })
  }
})
