// Hybrid 模式：問 Jev、把答案和同一批事實上的規則判定並列記錄
import {
  compareVerdicts,
  jevVerdict,
  type Agreement,
  type JevVerdict,
  type RuleVerdict,
} from '~/lib/hybrid/verdicts'
import { createJevJudge } from '~/lib/jev/judge'
import { downloadJson, sendHybrid } from '~/lib/jev/transport'

export interface Comparison {
  id: number
  /** 事實時間 */
  t: number
  state: string
  rule: RuleVerdict
  jev: JevVerdict
  agreement: Agreement
}

const MAX_COMPARISONS = 200

function rate(values: ReadonlyArray<boolean | null>) {
  const comparable = values.filter((v): v is boolean => v !== null)
  return comparable.length === 0 ? null : comparable.filter(Boolean).length / comparable.length
}

export function useJevCompare() {
  const version = ref(0)
  const judge = createJevJudge({
    set: 'hybrid',
    send: sendHybrid,
    describe: (state: string) => state,
    onChange: () => version.value++,
  })
  const comparisons = shallowRef<Comparison[]>([])
  const lastError = ref<string | null>(null)

  const stats = computed(() => {
    void version.value
    return judge.stats()
  })
  const busy = computed(() => {
    void version.value
    return judge.busy
  })
  const latest = computed(() => comparisons.value.at(-1) ?? null)
  const agreementRates = computed(() => ({
    intent: rate(comparisons.value.map((c) => c.agreement.intent)),
    waving: rate(comparisons.value.map((c) => c.agreement.waving)),
    motion: rate(comparisons.value.map((c) => c.agreement.motion)),
  }))
  const disagreements = computed(() =>
    comparisons.value.filter((c) => Object.values(c.agreement).some((v) => v === false)),
  )

  /** 問一次；judge 忙碌或失敗時回傳 null */
  async function ask(state: string, t: number, rule: RuleVerdict): Promise<JevVerdict | null> {
    const record = await judge.ask(state, t)
    if (!record) return null
    if (!record.answers) {
      lastError.value = record.error
      return null
    }
    lastError.value = null
    const jev = jevVerdict(t, record.answers)
    comparisons.value = [
      ...comparisons.value,
      { id: record.id, t, state, rule, jev, agreement: compareVerdicts(rule, jev) },
    ].slice(-MAX_COMPARISONS)
    return jev
  }

  function exportJson() {
    downloadJson(`jev-hybrid-${Date.now()}.json`, {
      ...judge.exportData(),
      agreementRates: agreementRates.value,
      comparisons: comparisons.value,
      disagreements: disagreements.value,
    })
  }

  function reset() {
    judge.reset()
    comparisons.value = []
    lastError.value = null
  }

  return { judge, stats, busy, latest, comparisons, agreementRates, disagreements, lastError, ask, exportJson, reset }
}
