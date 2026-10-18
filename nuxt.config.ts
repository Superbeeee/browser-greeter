export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  devtools: { enabled: false },
  typescript: {
    strict: true,
    // 測試檔也納入 type check（路徑相對於 .nuxt/）
    tsConfig: {
      include: ['../tests/**/*'],
    },
  },
  app: {
    head: {
      title: 'browser-greeter',
      htmlAttrs: { lang: 'zh-Hant-TW' },
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
  css: ['~/assets/main.css'],
})
