<script setup lang="ts">
const greeter = useGreeter()
const calibration = useCalibration()
const {
  camera,
  status,
  errorMessage,
  info,
  mode,
  imageConsent,
  imageFps,
  waveEnabled,
  gestureLoading,
  connections,
  facts,
  phase,
  transitions,
  waveMetrics,
  waveCount,
  reaction,
  stateText,
  gate,
  targetFps,
  actualFps,
  inferenceMs,
} = greeter
</script>

<template>
  <main class="layout">
    <header>
      <h1>browser-greeter</h1>
      <p>MediaPipe 管看見，Jev 管判斷。靠近鏡頭會打招呼，對它揮手會回應。</p>
    </header>

    <div class="controls">
      <button v-if="status !== 'running'" :disabled="status === 'loading'" @click="greeter.start">
        {{ status === 'loading' ? '載入模型中…' : '開啟鏡頭' }}
      </button>
      <button v-else class="secondary" @click="greeter.stop">停止</button>
      <label class="toggle" :class="{ disabled: mode === 'image' }">
        <input v-model="waveEnabled" type="checkbox" :disabled="mode === 'image'" />
        揮手偵測
        <span v-if="gestureLoading" class="muted">（載入手勢模型中…）</span>
      </label>
    </div>

    <ModeSwitch v-model:mode="mode" v-model:consent="imageConsent" v-model:image-fps="imageFps" class="modes" />

    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    <p v-if="camera.status.value === 'denied'" class="error">
      鏡頭權限被拒絕，請在瀏覽器網址列允許使用鏡頭後重新整理。
    </p>

    <div class="content">
      <div class="stage-wrap">
        <CameraStage :stream="camera.stream.value" :facts="facts" :connections="connections" :phase="phase">
          <template #placeholder>
            <span>按「開啟鏡頭」開始<br /><small>第一次使用前請先執行 pnpm setup:models</small></span>
          </template>
        </CameraStage>
        <GreetingBubble :reaction="reaction" />
      </div>
      <FactsPanel
        :mode="mode"
        :facts="facts"
        :phase="phase"
        :transitions="transitions"
        :wave-enabled="waveEnabled"
        :wave-metrics="waveMetrics"
        :wave-count="waveCount"
        :info="info"
        :target-fps="targetFps"
        :actual-fps="actualFps"
        :inference-ms="inferenceMs"
        :camera-status="camera.status.value"
      />
    </div>

    <ComparePanel
      class="section"
      :mode="mode"
      :compare="greeter.compare"
      :image="greeter.image"
      :gate="gate"
      :state-text="stateText"
    />
    <CalibrationPanel class="section" :calibration="calibration" :current-state="stateText" />
  </main>
</template>

<style scoped>
.layout {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
header h1 {
  margin: 0 0 4px;
  font-size: 1.6rem;
}
header p {
  margin: 0 0 16px;
  color: var(--muted);
}
.controls {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}
.modes {
  margin-bottom: 16px;
}
button {
  border: 0;
  border-radius: 8px;
  padding: 9px 18px;
  font: inherit;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  cursor: pointer;
}
button.secondary {
  background: #4b5363;
}
button:disabled {
  opacity: 0.6;
  cursor: progress;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.toggle.disabled {
  color: var(--muted);
  cursor: not-allowed;
}
.muted {
  color: var(--muted);
  font-size: 0.85rem;
}
.error {
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  padding: 8px 12px;
  border-radius: 8px;
}
.content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 20px;
  align-items: start;
}
.stage-wrap {
  position: relative;
}
.section {
  margin-top: 24px;
}
@media (max-width: 860px) {
  .content {
    grid-template-columns: 1fr;
  }
}
</style>
