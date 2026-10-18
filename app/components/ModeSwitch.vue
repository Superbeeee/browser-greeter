<script setup lang="ts">
import type { GreeterMode } from '~/composables/useGreeter'

const mode = defineModel<GreeterMode>('mode', { required: true })
const consent = defineModel<boolean>('consent', { required: true })
const imageFps = defineModel<number>('imageFps', { required: true })

const MODES: Array<{ value: GreeterMode; label: string; hint: string }> = [
  { value: 'rules', label: 'Rules', hint: 'MediaPipe 感知 + 手寫規則（v1）' },
  { value: 'hybrid', label: 'Hybrid', hint: 'MediaPipe 感知 + 規則，打招呼前問 Jev' },
  { value: 'image', label: 'Image（實驗）', hint: '畫面直接送 Jev 當感知引擎' },
]
</script>

<template>
  <div class="mode-switch">
    <div class="segmented" role="radiogroup" aria-label="判定模式">
      <label
        v-for="m in MODES"
        :key="m.value"
        :class="{ active: mode === m.value, disabled: m.value === 'image' && !consent }"
        :title="m.hint"
      >
        <input v-model="mode" type="radio" name="mode" :value="m.value" :disabled="m.value === 'image' && !consent" />
        {{ m.label }}
      </label>
    </div>

    <div class="image-opt-in" :class="{ on: consent }">
      <label>
        <input v-model="consent" type="checkbox" />
        <b>允許 Image 模式：鏡頭畫面會上傳到 TypeSafe</b>
      </label>
      <span class="detail">
        縮成 320×240 的 JPEG，每秒最多
        <input v-model.number="imageFps" type="range" min="2" max="4" step="1" :disabled="!consent" />
        {{ imageFps }} 張；不保存、不寫入 log 與匯出檔。其他模式影像都不離開瀏覽器。
      </span>
    </div>

    <p v-if="mode === 'image'" class="uploading">● 影像正在上傳到 TypeSafe</p>
  </div>
</template>

<style scoped>
.mode-switch {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.segmented {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
  width: fit-content;
}
.segmented label {
  position: relative;
  padding: 7px 14px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  border-right: 1px solid var(--border);
}
.segmented label:last-child {
  border-right: 0;
}
.segmented label.active {
  background: var(--accent);
  color: #fff;
}
.segmented label.disabled {
  color: var(--muted);
  cursor: not-allowed;
}
/* 視覺隱藏但保留鍵盤操作 */
.segmented input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
}
.segmented label:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.image-opt-in {
  font-size: 0.85rem;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.image-opt-in.on {
  border-color: #f59e0b;
  background: #fffbeb;
}
.detail {
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.detail input[type='range'] {
  width: 70px;
}
.uploading {
  margin: 0;
  color: #b45309;
  font-weight: 700;
}
</style>
