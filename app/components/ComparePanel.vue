<script setup lang="ts">
import type { GreeterMode } from '~/composables/useGreeter'
import type { useImageCompare } from '~/composables/useImageCompare'
import type { useJevCompare } from '~/composables/useJevCompare'
import { HYBRID_CONFIG, type GateDecision } from '~/lib/hybrid/adapter'
import { MOTION_LABELS } from '#shared/jev/questions'

const props = defineProps<{
  mode: GreeterMode
  compare: ReturnType<typeof useJevCompare>
  image: ReturnType<typeof useImageCompare>
  gate: GateDecision | null
  stateText: string | null
}>()

// composable 回傳的 ref 解構到頂層，template 才會自動 unwrap
const { stats, latest, comparisons, agreementRates, disagreements, lastError, busy } = props.compare
const {
  stats: imageStats,
  comparisons: boxComparisons,
  ratioDiff,
  imageTokens,
  lastError: imageError,
} = props.image

const INTENT_TEXT = { engage: '想互動', passing: '路過', pending: '未定' } as const
const MOTION_TEXT = { approaching: '靠近', staying: '停留', leaving: '離開' } as const
const GATE_TEXT: Record<GateDecision, string> = {
  pass: 'Jev 放行',
  'block-low-intent': 'Jev 判定路過，擋下',
  'block-waiting': '等待 Jev 判斷',
  fallback: '拿不到 Jev 判斷，照規則放行',
}

const fmtMs = (v: number | null) => (v === null ? '—' : `${Math.round(v)} ms`)
const fmtPct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const fmtUsd = (v: number) => `$${v.toFixed(6)}`
const fmt = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d))

const recentBoxes = computed(() => boxComparisons.value.slice(-8).reverse())
const recentDisagreements = computed(() => disagreements.value.slice(-5).reverse())
</script>

<template>
  <section class="compare">
    <header>
      <h2>規則 vs Jev</h2>
      <div class="actions">
        <button v-if="mode !== 'image'" class="ghost" :disabled="comparisons.length === 0" @click="compare.exportJson">
          匯出 Hybrid JSON
        </button>
        <button v-else class="ghost" :disabled="boxComparisons.length === 0" @click="image.exportJson">
          匯出 Image JSON
        </button>
      </div>
    </header>

    <p v-if="mode === 'rules'" class="hint">切到 Hybrid 模式後，狀態機進入 approaching 時會呼叫 Jev（每秒最多一次）。</p>

    <template v-if="mode !== 'image'">
      <div class="state">
        <span class="tag">目前的文字 state</span>
        <code>{{ stateText ?? '—' }}</code>
      </div>

      <div class="grid">
        <div class="card">
          <h3>Jev 最新判斷 <small v-if="busy">（請求中…）</small></h3>
          <template v-if="latest">
            <p class="sub">事實：{{ latest.state }}</p>
            <ProbBar label="想互動" :value="latest.jev.engage" :highlight="latest.jev.engage >= HYBRID_CONFIG.intentThreshold" />
            <ProbBar label="正在揮手" :value="latest.jev.waving" :highlight="latest.jev.waving >= 0.5" />
            <ProbBar
              v-for="m in MOTION_LABELS"
              :key="m"
              :label="MOTION_TEXT[m]"
              :value="latest.jev.motionProbs[m]"
              :highlight="latest.jev.motion === m"
            />
          </template>
          <p v-else class="hint">還沒有呼叫過 Jev</p>
          <p v-if="lastError" class="error">最近一次失敗：{{ lastError }}</p>
        </div>

        <div class="card">
          <h3>同一批事實的判定</h3>
          <table v-if="latest">
            <thead>
              <tr><th /><th>規則</th><th>Jev</th><th /></tr>
            </thead>
            <tbody>
              <tr>
                <th>想互動？</th>
                <td>{{ INTENT_TEXT[latest.rule.intent] }}</td>
                <td>{{ latest.jev.engage >= 0.5 ? '想互動' : '路過' }}（{{ fmt(latest.jev.engage) }}）</td>
                <td>{{ latest.agreement.intent === null ? '—' : latest.agreement.intent ? '✓' : '✗' }}</td>
              </tr>
              <tr>
                <th>在揮手？</th>
                <td>{{ latest.rule.waving ? '是' : '否' }}</td>
                <td>{{ latest.jev.waving >= 0.5 ? '是' : '否' }}（{{ fmt(latest.jev.waving) }}）</td>
                <td>{{ latest.agreement.waving ? '✓' : '✗' }}</td>
              </tr>
              <tr>
                <th>移動</th>
                <td>{{ MOTION_TEXT[latest.rule.motion] }}</td>
                <td>{{ MOTION_TEXT[latest.jev.motion] }}</td>
                <td>{{ latest.agreement.motion ? '✓' : '✗' }}</td>
              </tr>
            </tbody>
          </table>
          <p class="sub">
            一致率：想互動 {{ fmtPct(agreementRates.intent) }}／揮手 {{ fmtPct(agreementRates.waving) }}／移動
            {{ fmtPct(agreementRates.motion) }}
          </p>
          <p class="sub">打招呼關卡：{{ gate ? GATE_TEXT[gate] : '—' }}（門檻 P(想互動) ≥ {{ HYBRID_CONFIG.intentThreshold }}）</p>
        </div>

        <div class="card">
          <h3>呼叫統計</h3>
          <dl>
            <dt>呼叫次數</dt><dd>{{ stats.calls }}（失敗 {{ stats.failures }}，略過 {{ stats.skipped }}）</dd>
            <dt>平均延遲</dt><dd>{{ fmtMs(stats.meanMs) }}</dd>
            <dt>p95 延遲</dt><dd>{{ fmtMs(stats.p95Ms) }}</dd>
            <dt>input tokens</dt><dd>{{ stats.inputTokens.toLocaleString() }}</dd>
            <dt>累計成本</dt><dd>{{ fmtUsd(stats.costUsd) }}</dd>
          </dl>
        </div>
      </div>

      <div v-if="recentDisagreements.length" class="card">
        <h3>不一致的案例（最近 5 筆，完整清單在匯出檔）</h3>
        <ul class="cases">
          <li v-for="c in recentDisagreements" :key="c.id">
            <code>{{ c.state }}</code>
            <span>
              <template v-if="c.agreement.intent === false">想互動：規則 {{ INTENT_TEXT[c.rule.intent] }} / Jev {{ fmt(c.jev.engage) }}　</template>
              <template v-if="!c.agreement.waving">揮手：規則 {{ c.rule.waving ? '是' : '否' }} / Jev {{ fmt(c.jev.waving) }}　</template>
              <template v-if="!c.agreement.motion">移動：規則 {{ MOTION_TEXT[c.rule.motion] }} / Jev {{ MOTION_TEXT[c.jev.motion] }}</template>
            </span>
          </li>
        </ul>
      </div>
    </template>

    <template v-else>
      <div class="grid">
        <div class="card">
          <h3>臉寬比：Jev Box vs MediaPipe（同一幀）</h3>
          <dl>
            <dt>平均差（Jev − MP）</dt><dd>{{ fmt(ratioDiff.signed?.mean, 3) }}</dd>
            <dt>平均絕對差</dt><dd>{{ fmt(ratioDiff.absolute?.mean, 3) }}</dd>
            <dt>樣本數</dt><dd>{{ ratioDiff.signed?.n ?? 0 }}</dd>
          </dl>
          <table v-if="recentBoxes.length">
            <thead>
              <tr><th>Jev</th><th>MP</th><th>差</th><th>P(有人)</th><th>P(揮手)</th></tr>
            </thead>
            <tbody>
              <tr v-for="b in recentBoxes" :key="b.t">
                <td>{{ fmt(b.jevRatio) }}</td>
                <td>{{ fmt(b.mediapipeRatio) }}</td>
                <td>{{ fmt(b.diff, 3) }}</td>
                <td>{{ fmt(b.person) }}</td>
                <td>{{ fmt(b.waving) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="imageError" class="error">最近一次失敗：{{ imageError }}</p>
        </div>
        <div class="card">
          <h3>影像請求統計</h3>
          <dl>
            <dt>呼叫次數</dt><dd>{{ imageStats.calls }}（失敗 {{ imageStats.failures }}）</dd>
            <dt>平均延遲</dt><dd>{{ fmtMs(imageStats.meanMs) }}</dd>
            <dt>p95 延遲</dt><dd>{{ fmtMs(imageStats.p95Ms) }}</dd>
            <dt>每張 input tokens</dt><dd>{{ fmt(imageTokens?.mean, 0) }}（{{ fmt(imageTokens?.min, 0) }}～{{ fmt(imageTokens?.max, 0) }}）</dd>
            <dt>累計成本</dt><dd>{{ fmtUsd(imageStats.costUsd) }}</dd>
          </dl>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.compare {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h2 {
  margin: 0;
  font-size: 1.15rem;
}
h3 {
  margin: 0 0 8px;
  font-size: 0.85rem;
  color: var(--muted);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.state {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 0.85rem;
}
.tag {
  color: var(--muted);
  white-space: nowrap;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  background: #eef0f4;
  padding: 2px 6px;
  border-radius: 4px;
}
.sub,
.hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
}
.error {
  margin: 0;
  font-size: 0.8rem;
  color: #b91c1c;
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
  padding: 3px 4px;
  border-bottom: 1px solid var(--border);
}
thead th {
  color: var(--muted);
  font-weight: 600;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 0.9rem;
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.cases {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.82rem;
}
.cases li {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
button.ghost {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  border-radius: 8px;
  padding: 6px 12px;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
button.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
