import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 判定層與工具函式都是純 TS，不需要 Nuxt 環境
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
