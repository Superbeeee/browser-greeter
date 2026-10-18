<script setup lang="ts">
import type { CameraStatus } from '~/composables/useCamera'
import { PRESENCE_CONFIG, WAVE_CONFIG } from '~/lib/judgment/config'
import type { PresencePhase, PresenceTransition } from '~/lib/judgment/usePresenceStateMachine'
import type { WaveMetrics } from '~/lib/judgment/useWaveDetector'
import type { FrameFacts, ProviderInfo } from '~/lib/perception/types'

const props = defineProps<{
  facts: FrameFacts | null
  phase: PresencePhase
  transitions: readonly PresenceTransition[]
  waveEnabled: boolean
  waveMetrics: WaveMetrics
  waveCount: number
  info: ProviderInfo | null
  targetFps: number
  actualFps: number
  inferenceMs: number
  cameraStatus: CameraStatus
}>()

const PHASE_LABELS: Record<PresencePhase, string> = {
  idle: 'idle 待機',
  approaching: 'approaching 靠近中',
  greeted: 'greeted 已打招呼',
  cooldown: 'cooldown 冷卻中',
}

const CAMERA_LABELS: Record<CameraStatus, string> = {
  off: '未開啟',
  starting: '啟動中',
  live: '運作中',
  reconnecting: '斷線，重試中',
  denied: '未授權',
  error: '錯誤',
}

// 臉寬比量尺：最大顯示到 0.5
const SCALE_MAX = 0.5
const pct = (v: number) => `${Math.min(v / SCALE_MAX, 1) * 100}%`
const ratio = computed(() => props.facts?.face?.widthRatio ?? 0)

const fmt = (v: number | undefined | null, digits = 2) => (v == null ? '—' : v.toFixed(digits))
</script>

<template>
  <aside class="panel">
    <section>
      <h3>臉部</h3>
      <dl>
        <dt>臉寬比</dt>
        <dd>{{ fmt(facts?.face?.widthRatio) }}</dd>
        <dt>信心值</dt>
        <dd>{{ fmt(facts?.face?.score) }}</dd>
      </dl>
      <div class="meter" :title="`進入 ${PRESENCE_CONFIG.enterRatio} / 離開 ${PRESENCE_CONFIG.exitRatio}`">
        <div class="fill" :style="{ width: pct(ratio) }" />
        <div class="mark exit" :style="{ left: pct(PRESENCE_CONFIG.exitRatio) }" />
        <div class="mark enter" :style="{ left: pct(PRESENCE_CONFIG.enterRatio) }" />
      </div>
      <p class="hint">黃線：進入門檻 {{ PRESENCE_CONFIG.enterRatio }}　灰線：離開門檻 {{ PRESENCE_CONFIG.exitRatio }}</p>
    </section>

    <section>
      <h3>狀態機</h3>
      <p class="phase" :class="phase">{{ PHASE_LABELS[phase] }}</p>
      <ol class="log">
        <li v-for="tr in transitions" :key="`${tr.t}-${tr.to}`">
          <span class="time">{{ (tr.t / 1000).toFixed(1) }}s</span>
          {{ tr.from }} → <b>{{ tr.to }}</b>
          <span class="reason">{{ tr.reason }}</span>
        </li>
      </ol>
    </section>

    <section>
      <h3>手勢與揮手</h3>
      <template v-if="waveEnabled">
        <dl>
          <dt>手勢</dt>
          <dd>
            <template v-if="facts?.hand?.gesture">
              {{ facts.hand.gesture.name }}（{{ fmt(facts.hand.gesture.score) }}）
            </template>
            <template v-else-if="facts?.hand">無分類</template>
            <template v-else>沒有手</template>
          </dd>
          <dt>手腕 x</dt>
          <dd>{{ fmt(facts?.hand?.wrist.x, 3) }}</dd>
          <dt>折返次數</dt>
          <dd>{{ waveMetrics.reversals }} / {{ WAVE_CONFIG.minReversals }}</dd>
          <dt>擺幅</dt>
          <dd>{{ fmt(waveMetrics.amplitude) }} / {{ WAVE_CONFIG.minAmplitude }}</dd>
          <dt>揮手次數</dt>
          <dd>{{ waveCount }}</dd>
        </dl>
      </template>
      <p v-else class="hint">揮手偵測未開啟</p>
    </section>

    <section>
      <h3>執行環境</h3>
      <dl>
        <dt>鏡頭</dt>
        <dd>{{ CAMERA_LABELS[cameraStatus] }}</dd>
        <dt>Delegate</dt>
        <dd>
          臉 {{ info?.face ?? '—' }}
          <template v-if="info?.gesture">／手 {{ info.gesture }}</template>
        </dd>
        <dt>FPS</dt>
        <dd>{{ actualFps.toFixed(0) }} / 目標 {{ targetFps }}</dd>
        <dt>推論耗時</dt>
        <dd>{{ inferenceMs.toFixed(1) }} ms</dd>
      </dl>
    </section>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
section {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
}
h3 {
  margin: 0 0 8px;
  font-size: 0.85rem;
  color: var(--muted);
  letter-spacing: 0.05em;
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
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.meter {
  position: relative;
  height: 10px;
  margin-top: 10px;
  background: #eef0f4;
  border-radius: 5px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.1s linear;
}
.mark {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
}
.mark.enter {
  background: var(--warn);
}
.mark.exit {
  background: #9aa3b5;
}
.hint {
  margin: 6px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}
.phase {
  margin: 0 0 8px;
  font-weight: 700;
  font-size: 1.05rem;
}
.phase.approaching {
  color: var(--warn);
}
.phase.greeted {
  color: var(--ok);
}
.phase.cooldown {
  color: #3b82f6;
}
.log {
  list-style: none;
  white-space: nowrap;
  margin: 0;
  padding: 0;
  font-size: 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.time {
  display: inline-block;
  width: 4.5em;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.reason {
  color: var(--muted);
  margin-left: 4px;
}
</style>
