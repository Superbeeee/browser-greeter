// Image 模式：同一幀上比較 Jev Box 與 MediaPipe 的臉寬比，並記錄影像請求的 token 用量
import type { JevRecord } from '~/lib/jev/judge'
import { summarize } from '~/lib/jev/stats'
import { downloadJson } from '~/lib/jev/transport'
import { JevImageProvider } from '~/lib/perception/jev-image-provider'
import type { FrameFacts, PerceptionProvider } from '~/lib/perception/types'

export interface BoxComparison {
  t: number
  /** Jev 判定沒有人時為 null */
  jevRatio: number | null
  mediapipeRatio: number | null
  /** jevRatio - mediapipeRatio，任一方沒有臉時為 null */
  diff: number | null
  person: number
  waving: number
  inputTokens: number | null
  latencyMs: number
}

const MAX_COMPARISONS = 200

export function useImageCompare(shadow: () => PerceptionProvider | null) {
  const version = ref(0)
  const comparisons = shallowRef<BoxComparison[]>([])
  const lastError = ref<string | null>(null)
  // 擷取那一刻用同一幀跑 MediaPipe 的結果，等 Jev 回來再配對
  const shadowFacts = new Map<number, Promise<FrameFacts | null>>()
  const records = new Map<number, JevRecord<'image'>>()

  const provider = new JevImageProvider({
    onCapture(video, t) {
      const mp = shadow()
      shadowFacts.set(t, mp ? mp.detect(video, t).catch(() => null) : Promise.resolve(null))
    },
    onRecord(record) {
      version.value++
      if (record.answers) {
        records.set(record.t, record)
        lastError.value = null
      } else {
        lastError.value = record.error
        shadowFacts.delete(record.t)
      }
    },
  })

  const stats = computed(() => {
    void version.value
    return provider.judge.stats()
  })

  const ratioDiff = computed(() => {
    const diffs = comparisons.value.flatMap((c) => (c.diff === null ? [] : [c.diff]))
    return {
      signed: summarize(diffs),
      absolute: summarize(diffs.map(Math.abs)),
    }
  })

  const imageTokens = computed(() =>
    summarize(comparisons.value.flatMap((c) => (c.inputTokens === null ? [] : [c.inputTokens]))),
  )

  async function onFacts(f: FrameFacts) {
    const record = records.get(f.t)
    const mp = await (shadowFacts.get(f.t) ?? Promise.resolve(null))
    records.delete(f.t)
    shadowFacts.delete(f.t)
    if (!record?.answers) return
    const jevRatio = f.face?.widthRatio ?? null
    const mediapipeRatio = mp?.face?.widthRatio ?? null
    comparisons.value = [
      ...comparisons.value,
      {
        t: f.t,
        jevRatio,
        mediapipeRatio,
        diff: jevRatio !== null && mediapipeRatio !== null ? jevRatio - mediapipeRatio : null,
        person: record.answers.person.noul,
        waving: record.answers.waving.noul,
        inputTokens: record.inputTokens,
        latencyMs: record.latencyMs,
      },
    ].slice(-MAX_COMPARISONS)
  }

  function exportJson() {
    downloadJson(`jev-image-${Date.now()}.json`, {
      ...provider.judge.exportData(),
      note: '影像不保存，只記錄答案與用量',
      ratioDiff: ratioDiff.value,
      imageTokens: imageTokens.value,
      comparisons: comparisons.value,
    })
  }

  function reset() {
    provider.judge.reset()
    comparisons.value = []
    shadowFacts.clear()
    records.clear()
    lastError.value = null
  }

  return { provider, stats, comparisons, ratioDiff, imageTokens, lastError, onFacts, exportJson, reset }
}
