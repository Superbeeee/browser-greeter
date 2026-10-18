// 偵測迴圈的雙閘門：rAF 約 60Hz 一直跑，只有兩道閘門都過才推論。
// 1. 距離上次推論不足 1000 / fps 就跳過（目標 fps 節流）
// 2. video.currentTime 沒變就跳過（同一幀不重算）
// 呼叫端用同一個 performance.now() 做判斷與推論，timestamp 從源頭保證單調遞增。

export interface GateState {
  lastRunAt: number | null
  lastVideoTime: number | null
}

export interface GateInput {
  now: number
  videoTime: number
  fps: number
}

export type GateResult =
  | { run: true; gate: GateState }
  | { run: false; gate: GateState; skipped: 'throttle' | 'same-frame' }

export function initialGate(): GateState {
  return { lastRunAt: null, lastVideoTime: null }
}

export function passGate(gate: GateState, { now, videoTime, fps }: GateInput): GateResult {
  if (gate.lastRunAt !== null) {
    // 不足間隔或時間沒有前進（推論 timestamp 不可倒退或重複）都跳過
    if (now - gate.lastRunAt < 1000 / fps || now <= gate.lastRunAt) {
      return { run: false, gate, skipped: 'throttle' }
    }
  }
  if (gate.lastVideoTime !== null && videoTime === gate.lastVideoTime) {
    return { run: false, gate, skipped: 'same-frame' }
  }
  return { run: true, gate: { lastRunAt: now, lastVideoTime: videoTime } }
}
