# browser-greeter

在瀏覽器裡用鏡頭「看見」人：有人靠近就打招呼，對它揮手會回應。
推論全程在瀏覽器裡跑（WASM + GPU），影像不會離開你的裝置。

這個 repo 是部落格兩篇文章的 demo：

1. [和瀏覽器打招呼：來玩 Google 的神經網路計算 - MediaPipe](https://www.superbeeee.com/post/2026/07/mediapipe-browser-presence-detection/)
2. MediaPipe 管看見，Jev 管判斷（撰寫中）：在同一個 demo 上加入 TypeSafe 的 Jev（System One 決策模型）

## 版本

| tag | 內容 |
|---|---|
| `v1-mediapipe` | 第一篇文章：MediaPipe 感知 + 手寫規則判定（狀態機、揮手偵測） |
| `v2-jev-hybrid` | 第二篇文章：加入 Jev 判定，Rules / Hybrid / Image 三種模式比較 |

```sh
git checkout v1-mediapipe
```

## 三種模式

| 模式 | 感知 | 判定 | 影像離開瀏覽器？ |
|---|---|---|---|
| Rules | MediaPipe | 手寫規則（v1 原樣） | 否 |
| Hybrid | MediaPipe | 規則負責高頻判斷；進 greeted 前問 Jev「想互動還是路過」 | 否，只送文字摘要 |
| Image（實驗） | Jev（影像 + box 題） | 跟 Rules 同一套規則，一行都沒改 | **是**，需手動勾選同意 |

Hybrid 模式送給 Jev 的是 MediaPipe 事實的文字摘要，例如：

```
臉寬比 0.32，已持續 1.2 秒，趨勢變大；手腕在 0.8 秒內水平折返 3 次，擺幅 0.18；目前手勢 Open_Palm（0.92）
```

畫面下方有「規則 vs Jev」比較面板（各題機率、一致率、呼叫次數、平均與 p95 延遲、累計成本）與校準實驗（對同一份 state 連續問 N 次），都可以匯出 JSON。

## 架構

```
鏡頭影格 → 感知層（PerceptionProvider，逐幀事實）→ 判定層（狀態機、揮手偵測）→ 畫面回應
                                                   ↑
                         Hybrid：FactSerializer → /api/jev（proxy）→ Jev
```

- `app/lib/perception/`：感知層。`PerceptionProvider` 介面，`MediaPipeProvider` 與實驗性的 `JevImageProvider` 兩個實作。
- `app/lib/judgment/`：判定層。`usePresenceStateMachine`、`useWaveDetector` 是純邏輯，不 import 任何偵測引擎，時間由外部注入。所有門檻集中在 `config.ts`。v1 之後沒有改過。
- `app/lib/hybrid/`：Hybrid adapter（狀態機的修改全部集中在這裡）與規則／Jev 判定的對照。
- `app/lib/jev/`：FactSerializer、JevJudge（一次只有一個請求在途、記錄延遲與成本）、統計與校準。
- `shared/jev/`：前後端共用的模型版本、費率、題組。
- `server/api/jev.post.ts`：Jev proxy，唯一的 server route。
- `app/lib/loop/`：rAF 偵測迴圈的雙閘門節流（目標 fps、同一幀不重算）。
- `app/composables/`：鏡頭、偵測迴圈與整體組裝。

## 本地啟動

需求：Node.js 22.22+、pnpm 9+、有鏡頭的電腦。

```sh
pnpm install
pnpm setup:models   # 下載模型、複製 wasm 到 public/mediapipe/
pnpm dev
```

打開 http://localhost:3000 ，按「開啟鏡頭」並允許鏡頭權限。

其他指令：

```sh
pnpm test        # Vitest 單元測試
pnpm typecheck   # vue-tsc 型別檢查
pnpm build       # 先跑 type check 再 build
```

## 模型下載

MediaPipe 的 wasm runtime 與模型檔都自己 host，不走 CDN，離線也能跑。這些檔案不進 git，由 `pnpm setup:models` 產生：

| 檔案 | 來源 | 大小 |
|---|---|---|
| `public/mediapipe/wasm/*` | `node_modules/@mediapipe/tasks-vision/wasm` | 約 40 MB（SIMD、nosimd、ES module 三組） |
| `public/mediapipe/blaze_face_short_range.tflite` | Google MediaPipe 模型 storage | 約 0.2 MB |
| `public/mediapipe/gesture_recognizer.task` | Google MediaPipe 模型 storage | 約 8 MB |

已存在的檔案會跳過；升級 `@mediapipe/tasks-vision` 後請執行 `pnpm setup:models --force` 重新複製 wasm。

## TypeSafe key 設定

Hybrid 與 Image 模式需要 TypeSafe API key。key 只在 server route 讀取，不會進前端 bundle：

```sh
cp .env.example .env
# 編輯 .env，填入 TYPESAFE_API_KEY
```

改完 `.env` 要重啟 `pnpm dev`。沒有 key 時 Rules 模式照常可用；Hybrid 模式會在 approaching 5 秒後退回純規則。

模型版本寫死在 `shared/jev/config.ts`（文字題 `jev-1.13.0`、影像題 `jev-1.14.0`），費率 input $0.042 / 百萬 token、output 免費。

## 隱私

- Rules、Hybrid 模式：影像只在瀏覽器裡推論，不會上傳。Hybrid 只送文字摘要到自己的 proxy，再由 proxy 轉給 TypeSafe。
- Image 模式：會把縮小後的鏡頭畫面（384×288 JPEG）上傳到 TypeSafe。預設關閉，必須手動勾選同意；使用中畫面上會持續標示。
- 影像與 API key 不會出現在 log、匯出檔或 repo；proxy 關閉 SDK 的 log，只記題組、狀態碼、延遲與 token 數。
