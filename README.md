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
| `v2-jev-hybrid` | 第二篇文章：加入 Jev 判定，Rules / Hybrid / Image 三種模式比較（開發中） |

```sh
git checkout v1-mediapipe
```

## 架構

```
鏡頭影格 → 感知層（PerceptionProvider，逐幀事實）→ 判定層（狀態機、揮手偵測）→ 畫面回應
```

- `app/lib/perception/`：感知層。`PerceptionProvider` 介面與 `MediaPipeProvider` 實作，只回報「這一幀看到什麼」。
- `app/lib/judgment/`：判定層。`usePresenceStateMachine`、`useWaveDetector` 是純邏輯，不 import MediaPipe，時間由外部注入。所有門檻集中在 `config.ts`。
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

第二階段（`v2-jev-hybrid`）才會用到。key 只放在 server 端，不會進前端 bundle：

```sh
cp .env.example .env
# 編輯 .env，填入 TYPESAFE_API_KEY
```

## 隱私

- `v1-mediapipe`：影像只在瀏覽器裡推論，沒有任何上傳。
- 影像與 API key 不會出現在 log、匯出檔或 repo。
