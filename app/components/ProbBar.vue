<script setup lang="ts">
defineProps<{ label: string; value: number; highlight?: boolean }>()
</script>

<template>
  <div class="prob">
    <span class="label">{{ label }}</span>
    <span class="track"><span class="fill" :class="{ highlight }" :style="{ width: `${value * 100}%` }" /></span>
    <span class="num">{{ value.toFixed(2) }}</span>
  </div>
</template>

<style scoped>
.prob {
  display: grid;
  grid-template-columns: 6.5em 1fr 3em;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
}
.label {
  color: var(--muted);
}
.track {
  height: 8px;
  background: #eef0f4;
  border-radius: 4px;
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  background: #9aa3b5;
}
.fill.highlight {
  background: var(--accent);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
