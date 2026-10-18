<script setup lang="ts">
import type { useCalibration } from '~/composables/useCalibration'
import { INTENT_LABELS, MOTION_LABELS } from '#shared/jev/questions'
import type { Summary } from '~/lib/jev/stats'

const props = defineProps<{
  calibration: ReturnType<typeof useCalibration>
  /** 目前的文字 state，按「凍結」時複製過來 */
  currentState: string | null
}>()

const { frozenState, runs, running, done, failures, result, cost } = props.calibration

const INTENT_TEXT = { engage: '想互動', passing: '路過' } as const
const MOTION_TEXT = { approaching: '靠近', staying: '停留', leaving: '離開' } as const

const rows = computed(() => {
  const r = result.value
  if (!r) return []
  const list: Array<{ question: string; option: string; s: Summary; picks?: number }> = []
  for (const l of INTENT_LABELS) {
    list.push({ question: '想互動還是路過', option: INTENT_TEXT[l], s: r.intent.probabilities[l], picks: r.intent.picks[l] })
  }
  list.push({ question: '是否正在揮手', option: 'P(是)', s: r.waving })
  for (const l of MOTION_LABELS) {
    list.push({ question: '靠近／停留／離開', option: MOTION_TEXT[l], s: r.motion.probabilities[l], picks: r.motion.picks[l] })
  }
  return list
})

const f = (v: number, d = 3) => v.toFixed(d)
</script>

<template>
  <section class="calibration">
    <header>
      <h2>校準實驗</h2>
      <p>對同一份凍結的 state 連續問 N 次，看機率的分布。可以先凍結目前畫面的 state，再手動修改。</p>
    </header>

    <div class="controls">
      <button class="ghost" :disabled="!currentState || running" @click="calibration.freeze(currentState)">凍結目前的 state</button>
      <label>N <input v-model.number="runs" type="number" min="1" max="500" :disabled="running" /></label>
      <button v-if="!running" :disabled="!frozenState.trim()" @click="calibration.run">開始（依序呼叫）</button>
      <button v-else class="secondary" @click="calibration.cancel">停止</button>
      <button class="ghost" :disabled="!result || running" @click="calibration.exportJson">匯出 JSON</button>
    </div>

    <textarea v-model="frozenState" rows="2" :disabled="running" placeholder="按「凍結目前的 state」，或直接輸入一段事實描述" />

    <p v-if="running || done > 0" class="progress">
      進度 {{ done }} / {{ runs }}（失敗 {{ failures }}）　成本 ${{ cost.toFixed(6) }}
      <template v-if="result">　平均延遲 {{ Math.round(result.latency.mean) }} ms，p95 {{ Math.round(result.latency.p95) }} ms</template>
    </p>

    <table v-if="rows.length">
      <thead>
        <tr><th>題目</th><th>選項</th><th>平均</th><th>標準差</th><th>最小</th><th>最大</th><th>被選中</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="`${r.question}-${r.option}`">
          <td>{{ r.question }}</td>
          <td>{{ r.option }}</td>
          <td>{{ f(r.s.mean) }}</td>
          <td>{{ f(r.s.std) }}</td>
          <td>{{ f(r.s.min) }}</td>
          <td>{{ f(r.s.max) }}</td>
          <td>{{ r.picks ?? '—' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.calibration {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
}
h2 {
  margin: 0;
  font-size: 1.15rem;
}
header p {
  margin: 4px 0 0;
  font-size: 0.85rem;
  color: var(--muted);
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.controls input[type='number'] {
  width: 70px;
  font: inherit;
  padding: 4px 6px;
}
textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  resize: vertical;
}
.progress {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
th,
td {
  text-align: left;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}
thead th {
  color: var(--muted);
}
button {
  border: 0;
  border-radius: 8px;
  padding: 7px 14px;
  font: inherit;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  cursor: pointer;
}
button.secondary {
  background: #4b5363;
}
button.ghost {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  font-weight: 500;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
