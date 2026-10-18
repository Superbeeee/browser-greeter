// 校準實驗：對凍結的同一份 state 依序問 N 次（不並行，避免撞 rate limit，也符合不堆積）
import { summarizeCalibration, type CalibrationSample } from '~/lib/jev/calibration'
import { createJevJudge } from '~/lib/jev/judge'
import { downloadJson, sendHybrid } from '~/lib/jev/transport'

export function useCalibration() {
  const frozenState = ref('')
  const runs = ref(50)
  const running = ref(false)
  const done = ref(0)
  const failures = ref(0)
  const samples = shallowRef<CalibrationSample[]>([])
  let cancelled = false

  // 獨立的 judge，不影響 Hybrid 模式的統計
  const judge = createJevJudge({ set: 'hybrid', send: sendHybrid, describe: (s: string) => s })

  const result = computed(() => summarizeCalibration(samples.value))
  const cost = computed(() => {
    void done.value
    return judge.stats().costUsd
  })

  function freeze(state: string | null) {
    if (state) frozenState.value = state
  }

  async function run() {
    const state = frozenState.value.trim()
    if (running.value || !state) return
    running.value = true
    cancelled = false
    done.value = 0
    failures.value = 0
    samples.value = []
    judge.reset()
    const total = Math.max(1, Math.min(500, Math.floor(runs.value)))
    for (let i = 0; i < total && !cancelled; i++) {
      const record = await judge.ask(state)
      if (record?.answers) {
        samples.value = [
          ...samples.value,
          { answers: record.answers, latencyMs: record.latencyMs, inputTokens: record.inputTokens },
        ]
      } else {
        failures.value++
      }
      done.value = i + 1
    }
    running.value = false
  }

  function cancel() {
    cancelled = true
  }

  function exportJson() {
    downloadJson(`jev-calibration-${Date.now()}.json`, {
      ...judge.exportData(),
      state: frozenState.value,
      requestedRuns: runs.value,
      failures: failures.value,
      result: result.value,
    })
  }

  return { frozenState, runs, running, done, failures, result, cost, freeze, run, cancel, exportJson }
}
