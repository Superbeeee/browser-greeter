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

### 判定層的設計細節（文章沒寫數值，這裡補上）

- 兩個模組都寫成「純 reducer + 薄外殼」：`stepPresence(state, input, cfg)` / `stepWave(...)` 回傳新 state，
  `usePresenceStateMachine()` / `useWaveDetector()` 只是包一層可變狀態方便逐幀呼叫。
  state 是不可變的值，第二階段的 adapter 可以「看了結果再決定要不要採用」，不必改狀態機本身。
- 輸入型別用 `Pick<FrameFacts, 't' | 'face'>`、`Pick<FrameFacts, 't' | 'hand'>`，判定層只認得感知層的型別。
- 狀態機預設值：enterRatio 0.22、exitRatio 0.17（遲滯）、dwell 1000ms、greeted 顯示 2500ms、
  離開 2000ms 才回 idle、approaching 掉幀寬限 400ms。
- cooldown 的「離開」定義成「沒臉 **或** 臉寬比低於 exitRatio」。只看「臉消失」的話，人退到遠處但還在畫面裡就永遠回不了 idle。
- 揮手預設值：視窗 1200ms、折返 3 次、擺幅 0.08、deadband 0.02、掉幀寬限 400ms、不反應期 1500ms。
- 揮手起點不算折返：第一段位移只用來確定方向。一開始把起點也算進去，等於少揮一下就觸發。
- 手在寬限外重新出現時清掉舊軌跡，否則上一次殘留的折返點會跟這次拼在一起。
- 寫測試時踩到：抖動幅度剛好等於 deadband 會被算成折返（判斷用 `>=`），測試資料要明確小於門檻。

### 跑起來之後的觀察（headless Chrome + 假鏡頭）

- Chrome 的 `--use-fake-device-for-media-stream` 假鏡頭畫面（綠底 + 旋轉的扇形 + 計時數字）會被 BlazeFace 當成一張臉，
  信心值約 0.54、臉寬比 0.46，狀態機還真的走完一輪 idle → approaching → greeted → cooldown。
  `minDetectionConfidence: 0.5` 擋不住，可以當「規則判定只看數字、不懂語意」的例子，也是第二篇讓 Jev 來判斷的伏筆。
- GestureRecognizer 回報 GPU delegate 建立成功，但 console 會出現
  `Hand Gesture Recognizer contains CPU only ops. Sets HandGestureRecognizerGraph acceleration to Xnnpack.`
  ——手勢分類那段其實跑在 CPU（XNNPACK）。「delegate 建立成功」不等於「整條 graph 都在 GPU」。
- 臉 + 手兩個模型同時開，12fps 達標，單次推論約 18ms（headless 環境，實機會不同）。

### 畫面

- 鏡像用 CSS `scaleX(-1)` 包住 video + canvas，overlay 照原始座標畫；文字繪製時局部 `scale(-1, 1)` 翻回來，
  對齊方向也要反過來（`textAlign: 'right'`），不然標籤會貼在框的另一側。
- 臉框貼到畫面頂端時，標籤會畫到 canvas 外面，改畫在框內。
- 預覽用另一個掛在 DOM 的 video 綁同一條 MediaStream；推論用的 video 一直不在 DOM 裡。
- 揮手開關在手勢模型載入中被關掉時，載入完成後會誤開。改成 `setHandTracking` 先記下想要的狀態，`detect()` 再同時確認模型已載入。
