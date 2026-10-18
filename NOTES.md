# 寫作素材筆記

邊做邊記，給兩篇文章取材用。數值都來自我自己的環境，僅供參考。

## 第一階段：MediaPipe 版

### 版本與環境

- Nuxt 4.6.2、@mediapipe/tasks-vision 1.1.1、Vitest 5、vue-tsc 3.3
- TypeScript 固定在 6.0.x：7.x 是 Go 原生實作，vue-tsc 依賴 TS 的 JS API，先不冒險。
- Nuxt 4.6 的 engines 要求 Node `^22.22.3`，本機 22.22.2 只會出警告，可以跑。

### 資源 hosting

- `pnpm setup:models` 從 node_modules 複製 wasm，從 Google storage 下載模型，`public/mediapipe/` 整個不進 git。
- tasks-vision 1.1.1 的 wasm 目錄多了一組 `vision_wasm_module_internal.*`（給 `forVisionTasks(path, useModule=true)` 用的 ES module 版本），加上 SIMD / nosimd 共三組，各約 13MB。
- 下載先寫 `.download` 暫存檔、完成才改名，避免中斷後留下半個檔案被當成「已存在」跳過。

### 踩坑

- `WasmFileset` 型別在 `vision.d.ts` 只有 `declare interface`、沒有 export，import 會被 type check 擋下。
  改用 `Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>` 推導。再次印證文章說的「直接 grep vision.d.ts」。
- 手勢模型載入失敗時要把 pending promise 清掉，不然下次開揮手功能會永遠拿到同一個 rejected promise。
