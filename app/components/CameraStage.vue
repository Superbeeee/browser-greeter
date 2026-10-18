<script setup lang="ts">
import type { PresencePhase } from '~/lib/judgment/usePresenceStateMachine'
import type { FrameFacts } from '~/lib/perception/types'
import { drawOverlay } from '~/lib/render/overlay'

const props = defineProps<{
  stream: MediaStream | null
  facts: FrameFacts | null
  connections: ReadonlyArray<{ start: number; end: number }>
  phase: PresencePhase
}>()

const preview = ref<HTMLVideoElement | null>(null)
const overlay = ref<HTMLCanvasElement | null>(null)

const PHASE_COLORS: Record<PresencePhase, string> = {
  idle: '#9aa3b5',
  approaching: '#f59e0b',
  greeted: '#22c55e',
  cooldown: '#60a5fa',
}

// 預覽另外用一個 video 綁同一條 stream；推論用的 video 不在 DOM 裡
watch(
  () => props.stream,
  (stream) => {
    if (preview.value) preview.value.srcObject = stream
  },
)
onMounted(() => {
  if (preview.value) preview.value.srcObject = props.stream
})

watch(
  () => props.facts,
  (facts) => {
    const canvas = overlay.value
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const video = preview.value
    if (video?.videoWidth && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
    }
    drawOverlay(ctx, {
      face: facts?.face ?? null,
      hand: facts?.hand ?? null,
      connections: props.connections,
      mirrored: true,
      style: { faceColor: PHASE_COLORS[props.phase], handColor: '#e879f9', wristColor: '#facc15' },
    })
  },
)
</script>

<template>
  <div class="stage">
    <div class="mirror">
      <video ref="preview" autoplay muted playsinline />
      <canvas ref="overlay" width="640" height="480" />
    </div>
    <div v-if="!stream" class="placeholder">
      <slot name="placeholder" />
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  aspect-ratio: 4 / 3;
  width: 100%;
  background: #11151c;
  border-radius: 12px;
  overflow: hidden;
}
.mirror {
  position: absolute;
  inset: 0;
  /* 預覽鏡像，比較符合照鏡子的直覺；overlay 一起翻 */
  transform: scaleX(-1);
}
video,
canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #cbd2de;
  text-align: center;
  padding: 24px;
}
</style>
