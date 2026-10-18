import type { FaceFact, HandFact } from '~/lib/perception/types'

/** 假的臉部事實，只有臉寬比有意義 */
export function face(widthRatio: number, score = 0.9): FaceFact {
  return { widthRatio, score, box: { x: 0.4, y: 0.3, width: widthRatio, height: widthRatio } }
}

/** 假的手部事實，只有手腕 x 有意義 */
export function hand(x: number, y = 0.6): HandFact {
  const wrist = { x, y }
  return {
    gesture: { name: 'Open_Palm', score: 0.9 },
    landmarks: Array.from({ length: 21 }, () => ({ x, y, z: 0 })),
    wrist,
  }
}

/** 以固定 fps 產生時間序列 [t0, t0+dt, ...]，涵蓋 durationMs */
export function frames(t0: number, durationMs: number, fps: number): number[] {
  const dt = 1000 / fps
  const out: number[] = []
  for (let t = t0; t <= t0 + durationMs + 1e-9; t += dt) out.push(Math.round(t))
  return out
}
