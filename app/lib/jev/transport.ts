// 前端呼叫自家 proxy
import { IMAGE_FORM_FIELDS, type JevProxyResponse, type JevTextRequest } from '#shared/jev/protocol'

const ENDPOINT = '/api/jev'

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // proxy 只回狀態碼與簡短訊息
    let message = res.statusText
    try {
      const body = (await res.json()) as { statusMessage?: string }
      message = body.statusMessage ?? message
    } catch {
      // 非 JSON 錯誤 body，沿用 statusText
    }
    throw new Error(`HTTP ${res.status} ${message}`.trim())
  }
  return (await res.json()) as T
}

export async function sendHybrid(state: string): Promise<JevProxyResponse<'hybrid'>> {
  const body: JevTextRequest = { set: 'hybrid', state }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parse(res)
}

export async function sendImage(jpeg: Blob): Promise<JevProxyResponse<'image'>> {
  const form = new FormData()
  form.append(IMAGE_FORM_FIELDS.set, 'image')
  form.append(IMAGE_FORM_FIELDS.image, jpeg, 'frame.jpg')
  return parse(await fetch(ENDPOINT, { method: 'POST', body: form }))
}

/** 把 JSON 存成檔案下載 */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
