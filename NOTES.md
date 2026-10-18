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

## 第二階段：加入 Jev

### TypeSafe SDK（@typesafe-ai/sdk 0.7.0）讀型別才知道的事

- 官方 HTTP API 頁只寫 noul / choice / score，影像、`box`、`TypeSafe-Danger-Zone-Images` header、`jev-preview` 都只出現在 JS SDK 頁。
- 帶影像的請求由 SDK 自動組成 `multipart/form-data`，不是 JSON 裡夾 base64；`Image.fromBase64()` 只是 SDK 端的方便方法。
- `usage.input_tokens` / `output_tokens` 型別是 `number | null`，「API 沒回報」是合法狀態，成本計算要處理 null。
- `box` 回答的 `confidence` 也是 `number | null`；而且 box 題**沒有「找不到」的答案**，一定回傳一個框，所以「有沒有人」要另外問一題 noul。
- 預設會重試 2 次（408、429、5xx、連線錯誤、timeout 都重試），單次 timeout 10 秒，**沒有總時間上限**。
  量延遲時這會灌水 p95，所以 proxy 設 `retry: { maxRetries: 0 }`。
- `logLevel: 'debug'` 會把請求與回應 body 原樣印出（只遮 credential header）。影像、state 都會進 log，proxy 直接設 `'off'`，自己記去敏摘要。
- SDK 在瀏覽器裡會直接丟錯拒絕執行（除非 `dangerouslyAllowBrowser: true`），從設計上逼你走 server。
- 費率：input $0.042 / 百萬 token，output 免費（docs.typesafe.ai/models）。`jev-latest` 指向 1.13.0、`jev-preview` 指向 1.14.0；本專案寫死版本號。

### Proxy

- 前端只能選題組（`hybrid` / `image`）並給 state，題目、題數、模型都由 server 決定。比「照單轉發任意 System One 請求」安全，也確保比較實驗用的題目固定。
- 限制：文字 state 2000 字元、影像 200KB 且必須是 JPEG（檢查 magic bytes）、沒有 Content-Length 一律拒絕。
- key 直接從 server 端 `process.env.TYPESAFE_API_KEY` 讀，不放進 Nuxt `runtimeConfig`——避免 build 時被序列化進產物。
- 上游錯誤只回狀態碼，不轉傳錯誤 body（可能回顯請求內容）。
- 踩坑：新增 `server/` 目錄後，已經在跑的 `nuxt dev` 不會註冊新的 API route，打 `/api/jev` 會拿到 SPA 首頁的 200。要重啟 dev server。

### FactSerializer

- 只描述事實，不放規則的結論（例如狀態機目前在 approaching）。放了等於暗示 Jev 答案，比較實驗就不公平了。
- 折返統計直接把緩衝區重播進判定層的 `stepWave`（門檻設成無限大，只拿 metrics），不另寫一套演算法。
  好處是規則與 Jev 看到的「折返次數」定義完全一致。
- 「已持續」只在緩衝區（5 秒）滿了而且一路在場到開頭時才寫「5.0 秒以上」，不然剛開鏡頭就有人的情況會被誤寫成「以上」。
- 格式範例：`臉寬比 0.32，已持續 1.0 秒，趨勢變大；手腕在 0.8 秒內水平折返 3 次，擺幅 0.18；目前手勢 Open_Palm（0.92）`，約 60 字。

### Hybrid adapter：判定層有沒有改？

- **`usePresenceStateMachine.ts` 一行都沒動。** adapter 先讓 `stepPresence` 照常算，再決定採不採用：
  規則想從 approaching 進 greeted 時多一道關卡，Jev 的 P(想互動) ≥ 0.6 才放行。
- 被擋下時不是丟掉整個新 state，而是「採用規則算出的其他欄位（臉寬比、最後在場時間），只把 phase / phaseSince 留在 approaching」。
  如果整個丟掉，`lastNearAt` 不會更新，人還在但會被誤判成掉幀太久。
  **這是 adapter 和狀態機唯一的耦合**：要知道 PresenceState 有 `phase`、`phaseSince` 兩個欄位。第一篇把 state 設計成不可變的值，這裡才能這樣做。
- dwell 計時在被擋下期間繼續累積，Jev 一改口就能立刻放行，不用重新等 1 秒。
- 關卡的四種決定：`pass`、`block-low-intent`、`block-waiting`（還沒有新鮮的判斷）、`fallback`
  （這段 approaching 開始 5 秒內都沒拿到任何 Jev 判斷，照規則放行，避免 TypeSafe 掛掉時整個 demo 不會打招呼）。
- 判斷要「新鮮」：事實時間距今 2 秒內，而且必須是這段 approaching 開始之後的事實；晚回來的舊判斷不能蓋掉新判斷。
- 規則沒有「想互動」的概念，比較面板裡規則的 intent 只能用狀態機進度推：停留滿 dwell 算 engage、之前是 pending、不夠近是 passing。
  pending 時不列入一致率。這本身就是文章素材：**規則只能等時間到，Jev 可以在 dwell 之前就給機率。**

### 換引擎的實驗：感知層介面改了什麼（選項 A 的結果）

v1 照第一篇的設計維持同步介面，到 v2 才為了 JevImageProvider 改。`git diff v1-mediapipe -- app/lib/judgment/` 是空的——**判定層真的一行都沒改**。
要改的是感知層介面和偵測迴圈，因為 v1 的介面其實是照 MediaPipe 的形狀設計的：

1. `detect()` 從同步改成回傳 `Promise<FrameFacts>`。MediaPipe 是同步推論，遠端引擎要打網路。
2. 偵測迴圈加 in-flight 保護：上一次推論沒結束不送下一幀。MediaPipe 時代不需要，因為同步呼叫天生不會重疊。
   另外加 generation 計數，停止或切換引擎時把還在途的舊結果丟掉。
3. `FrameFacts` 加了選填的 `waving?: number`。v1 假設每個引擎都能給 21 個關節點，揮手由判定層追蹤手腕軌跡；
   Jev 看單張圖給不出關節點，只能直接給「像在揮手」的機率。
4. `ProviderInfo` 的 delegate 多了 `'remote'`。

結論可以寫成：「判定層不用改」成立，但前提是感知層介面要先長對。第一版介面裡藏著三個 MediaPipe 的假設：同步、本機、有關節點。
