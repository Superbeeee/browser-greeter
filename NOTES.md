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

### Image 模式（實驗性）

- JevImageProvider 把畫面縮成 384×288 JPEG（品質 0.7），一次問三題：`person`（noul，有沒有清楚的人臉）、`face`（box）、`waving`（noul）。
  P(有人) ≥ 0.5 才把 box 當成臉，臉寬比 = `right - left`（box 座標本來就是相對寬高的比例，跟 MediaPipe 的臉寬比定義一致）。
- 跟 MediaPipe 比對臉寬比：擷取影像的那一刻，用**同一幀**跑一次 MediaPipe，等 Jev 回來再用事實時間 t 配對。
- 揮手：單張圖看不出「來回擺動」，問的其實是「姿勢像不像在揮手」（舉起張開的手掌）。判定層的 `useWaveDetector` 在 Image 模式吃不到手腕座標，
  所以揮手改由 `FrameFacts.waving` ≥ 0.5 觸發，不反應期沿用規則的 1500ms。**這是三種模式中唯一換掉規則的地方**。
- 狀態機用的是跟 Rules 模式同一個、沒改過的 `usePresenceStateMachine`。
- Jev 請求失敗時不產生事實（丟例外讓迴圈跳過），寧可這一幀沒資料，也不要假裝「沒有臉」而讓狀態機誤判有人離開。
- 事實時間用擷取那一刻，不是回應回來的時間；判定層看到的時間仍然單調遞增，只是整體晚了一個請求的延遲。

### UI 與隱私

- Image 模式預設關閉：沒有勾選「允許上傳」就切不進去；取消勾選會立刻退回 Rules；使用中畫面持續顯示「影像正在上傳」。
- 匯出檔：Hybrid 匯出含文字 state、規則與 Jev 的判定、不一致案例；Image 匯出只有答案、臉寬比與用量，`state` 欄位一律是 null。
- build 後 grep 過 `.output/public`：沒有 SDK、endpoint、`TYPESAFE_API_KEY` 字樣。題組檔只 `import type` SDK，不會把 SDK 打包進前端。
- 測試 Hybrid 時沒有 key：approaching 期間每秒一次請求都 503，5 秒後 fallback 照規則打招呼。fallback 的設計在這時候證明有必要。

## 實測：真實 Jev 呼叫（2026-10-18）

測試方式：curl 直接打本機 proxy（手寫的文字 state），加上 headless Chrome 假鏡頭跑完整流程。全程沒有用到任何真人影像。

### 延遲與成本

| 項目 | 文字（Hybrid，jev-1.13.0） | 影像（Image，jev-1.14.0） |
| --- | --- | --- |
| 每次 input tokens | 686～730（三題 + 一行 state） | 824～831（384×288 JPEG + 三題） |
| 上游延遲 | 平均 394ms、p95 736ms、最小 185、最大 1219（n=50） | 平均 299ms、p95 423ms（n=30） |
| 每次成本 | 約 $0.00003 | 約 $0.000035 |
| 換算 | Hybrid 只在 approaching 期間每秒最多一次，就算一直有人也只有約 $0.1／小時 | 3fps 連續送約 $0.006／分鐘、$0.37／小時 |

- `usage.input_tokens` 實測都有值，沒遇到型別上允許的 null。
- 第一次呼叫明顯比較慢（741ms），之後大多 200～500ms，偶爾超過 1 秒。p95 比平均高快一倍，所以 Hybrid 用「上一個沒回來就跳過」而不是排隊是對的。
- 一張 384×288 的圖跟一行中文 state 的 token 數差不多。影像比想像中便宜，貴的是頻率。
- 整個測試（約 130 次呼叫）總成本不到 $0.005。

### 踩坑：影像尺寸下限

- 原本送 320×240，上游回 `400 Invalid image dimensions.`。文件（https://docs.typesafe.ai/images）寫：**每邊 280～1568px、總像素 78,400 以上，超出範圍直接拒收，不會幫你縮放**。
- 改成 384×288：4:3 維持跟鏡頭同比例（box 座標才能直接對回原畫面），也是 4:3 裡最接近下限的整數尺寸。下限寫進 `JEV_LIMITS.minImageSide`，provider 建構時就檢查。
- proxy 刻意不轉發上游錯誤 body，所以前端只看得到 `Upstream 400`。要查原因得在 server 端直接用 SDK 打一次看 `APIError` 的 message。這是「log 不放內容」的代價。

### Box 題：沒有臉也會給框

- 一張沒有人臉的合成圖：`person` 0.01，`face` 還是框了一塊（top 0.47、bottom 0.53、left 0.10、right 0.45），`confidence` 0.07。
- 符合讀 SDK 型別時的預期：Box 沒有「找不到」這個答案。所以一定要另外問一題 noul「有沒有人臉」當閘門。box 的 `confidence` 也可以當第二道參考。

### 規則 vs Jev：不一致的案例

固定 state 各問 3 次，數字為 3 次的範圍：

| 情境 | state 重點 | 規則 | Jev |
| --- | --- | --- | --- |
| 靠近並揮手 | 0.32、變大、折返 3 次擺幅 0.18 | 想互動、揮手 | engage 0.96～0.97、wave 0.82～0.83 |
| **遠處路過** | 臉寬比 0.12、持續 1.5 秒、穩定 | 沒進 approaching（< 0.22） | **engage 0.84～0.88** |
| 快速掠過 | 0.25、只持續 0.4 秒、變大 | 規則還在等 dwell | engage 0.55～0.58（剛好在 0.6 門檻下） |
| 抓頭小動作 | 折返 1 次、擺幅 0.05 | 不是揮手 | wave 0.06（一致） |
| **擺幅小折返多** | 折返 4 次、擺幅 0.06 | 不是揮手（< 0.08） | **wave 0.77～0.79** |
| 手掌不動 | 沒有折返、Open_Palm 0.95 | 不是揮手 | wave 0.07～0.08（一致，沒被手勢名稱騙到） |
| 正在離開 / 臉剛消失 | 變小 / 已消失 0.6 秒 | 離開 | engage 0.00～0.05、leaving 1.0 |

- **Jev 不知道數字的尺度。** 題目只在 `motion` 說了「臉寬比越大越近」，沒說 0.12 算遠、0.08 擺幅才算明顯。Jev 看到「穩定停留 1.5 秒」就判想互動，看到「折返 4 次」就判揮手。這不是模型能力問題，是 state 跟題目沒給尺度。要改的話是在 state 或 criteria 裡加「臉寬比 0.2 以下代表離螢幕還很遠」這類說明。目前保留原樣當對照。
- 「遠處路過」在 Hybrid 實際上不會送出：只有 approaching（臉寬比 ≥ 0.22）期間才會問 Jev。規則先過濾、Jev 只判斷邊界，這個分工剛好擋掉 Jev 最弱的地方。
- Jev 對「手勢名稱」很克制：Open_Palm 0.95 但沒有折返，wave 只給 0.07。它看的是動作描述，不是標籤。
- 同一 state 重複問，機率幾乎不動（多數差 0.01～0.03）。

### 校準實驗：邊界 state 問 50 次

state：「臉寬比 0.25，已持續 0.4 秒，趨勢變大；沒有偵測到手」（剛好在想互動與路過之間）

- P(engage)：平均 0.545、std 0.053、最小 0.40、最大 0.66。choice 選 engage 41 次、passing 9 次。
- P(waving)：0.03～0.04，std 0.004；P(approaching)：50 次都是 1.00。
- 50 次裡只有 11 次 ≥ 0.6，也就是 Hybrid 門檻在這個 state 上約 22% 會放行。**門檻附近的 state 是隨機的**。明確的題目（揮手、移動方向）幾乎零變異，模糊的題目（意圖）才會飄。
- 這也說明為什麼 adapter 只用「最新一次」判定並在 approaching 期間每秒重問：單次判定在邊界會抖，多問幾次會收斂到 state 本身變得明確的時候。

### 完整流程（headless Chrome 假鏡頭）

- **Hybrid**：idle → approaching → Jev 回 P(想互動) 0.91 放行 → greeted → cooldown。approaching 約 3.7 秒內呼叫 4 次，失敗 0、略過 0，平均 460ms。
- **Hybrid 抓到的不一致**：假鏡頭的臉偵測斷斷續續。臉消失 0.1 秒時 state 變成「沒有偵測到臉（已消失 0.1 秒）」，Jev 給 P(想互動) 0.00，規則因為還在寬限期內仍判想互動。serializer 只描述「現在」，沒帶上「剛剛 3 秒一直都在」。如果這筆剛好是最新判定，會擋掉一次本來該打的招呼。改進方向：臉剛消失時，state 補上消失前的臉寬比與持續時間。
- **Image**：30 次呼叫、失敗 0。Chrome 假鏡頭的畫面（沒有人臉的測試圖樣）MediaPipe 判成有臉、臉寬比約 0.5，Jev 的 P(有人) 只有 0.01～0.02。**兩個引擎在同一幀上給出相反的事實**，判定層一行沒改，結論卻完全不同。這是「感知層決定事實、判定層只認事實」最直接的例子。
- 撤回 Image 同意後立刻退回 Rules、Image 選項重新鎖住。
- Server log 90 行 hybrid 紀錄，只有 set、狀態碼、毫秒與 token 數，沒有 state 內容或 key。
