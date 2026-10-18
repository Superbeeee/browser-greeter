export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  devtools: { enabled: false },
  typescript: {
    strict: true,
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
