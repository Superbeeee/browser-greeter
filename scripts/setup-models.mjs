// 準備 MediaPipe 執行所需的資源到 public/mediapipe/：
// 1. 從 node_modules 複製 wasm runtime（版本跟著 package.json 走）
// 2. 從 Google 官方 storage 下載模型檔
// 已存在且大小不為 0 的檔案會跳過；加 --force 強制重新下載與複製。
import { copyFile, mkdir, readdir, rename, stat, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'mediapipe')
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const wasmOut = join(outDir, 'wasm')
const force = process.argv.includes('--force')

const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models'
const models = [
  {
    file: 'blaze_face_short_range.tflite',
    url: `${MODEL_BASE}/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite`,
  },
  {
    file: 'gesture_recognizer.task',
    url: `${MODEL_BASE}/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task`,
  },
]

async function exists(path) {
  try {
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function copyWasm() {
  let files
  try {
    files = await readdir(wasmSrc)
  } catch {
    throw new Error(`找不到 ${wasmSrc}，請先執行 pnpm install`)
  }
  await mkdir(wasmOut, { recursive: true })
  for (const file of files) {
    const dest = join(wasmOut, file)
    if (!force && (await exists(dest))) {
      console.log(`略過  wasm/${file}`)
      continue
    }
    await copyFile(join(wasmSrc, file), dest)
    console.log(`複製  wasm/${file}`)
  }
}

async function download({ file, url }) {
  const dest = join(outDir, file)
  if (!force && (await exists(dest))) {
    console.log(`略過  ${file}`)
    return
  }
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`下載 ${file} 失敗：HTTP ${res.status}`)
  }
  // 先寫暫存檔，完整下載後才改名，避免中斷時留下半個檔案被當成已存在
  const tmp = `${dest}.download`
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
    await rename(tmp, dest)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
  console.log(`下載  ${file}（${formatSize((await stat(dest)).size)}）`)
}

await mkdir(outDir, { recursive: true })
await copyWasm()
for (const model of models) {
  await download(model)
}
console.log(`完成，資源位於 ${outDir}`)
