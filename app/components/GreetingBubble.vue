<script setup lang="ts">
import type { Reaction } from '~/composables/useGreeter'

defineProps<{ reaction: Reaction | null }>()
</script>

<template>
  <Transition name="pop">
    <div v-if="reaction" :key="reaction.t" class="bubble" :class="reaction.kind">
      {{ reaction.text }}
    </div>
  </Transition>
</template>

<style scoped>
.bubble {
  position: absolute;
  left: 50%;
  top: 20px;
  transform: translateX(-50%);
  padding: 12px 22px;
  border-radius: 999px;
  font-size: 1.4rem;
  font-weight: 700;
  color: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  white-space: nowrap;
}
.greet {
  background: var(--ok);
}
.wave {
  background: var(--accent);
}
.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-12px) scale(0.9);
}
</style>
