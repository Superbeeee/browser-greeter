import { describe, expect, it } from 'vitest'
import {
  createFactWindow,
  serializeFacts,
  summarizeFacts,
  type SerializerConfig,
} from '~/lib/jev/fact-serializer'
import type { FrameFacts } from '~/lib/perception/types'
import { face, frames, hand } from './helpers/facts'

const cfg: SerializerConfig = { windowMs: 5000, trendMs: 1000, trendPerSecond: 0.03, presenceGapMs: 400 }

function frame(t: number, opts: Partial<Omit<FrameFacts, 't'>> = {}): FrameFacts {
  return { t, face: null, hand: null, handTracking: false, ...opts }
}

/** 臉寬比從 from 線性變到 to */
function approach(t0: number, durationMs: number, from: number, to: number, extra: Partial<FrameFacts> = {}) {
  const ts = frames(t0, durationMs, 8)
  return ts.map((t) => frame(t, { face: face(from + ((to - from) * (t - t0)) / durationMs), ...extra }))
}

/** 揮手：正弦擺動的手腕，12fps */
function waving(t0: number, durationMs: number, amplitude: number, ratio = 0.32) {
  return frames(t0, durationMs, 12).map((t) =>
    frame(t, {
      face: face(ratio),
      handTracking: true,
      hand: { ...hand(0.5 + (amplitude / 2) * Math.sin((2 * Math.PI * (t - t0)) / 600)), gesture: { name: 'Open_Palm', score: 0.92 } },
    }),
  )
}

describe('serializeFacts', () => {
  it('沒有事實時回傳 null', () => {
    expect(serializeFacts([], cfg)).toBeNull()
  })

  it('靠近中：臉寬比、持續時間、趨勢變大', () => {
    // 時長取 125ms（8fps）的整數倍，最後一幀才會剛好落在終點
    const text = serializeFacts(approach(1000, 1000, 0.2, 0.32), cfg)
    expect(text).toBe('臉寬比 0.32，已持續 1.0 秒，趨勢變大；未追蹤手部')
  })

  it('停留：趨勢穩定', () => {
    expect(serializeFacts(approach(0, 2000, 0.3, 0.3), cfg)).toBe('臉寬比 0.30，已持續 2.0 秒，趨勢穩定；未追蹤手部')
  })

  it('離開：趨勢變小', () => {
    expect(serializeFacts(approach(0, 1000, 0.3, 0.18), cfg)).toContain('趨勢變小')
  })

  it('樣本不足時趨勢不明', () => {
    expect(serializeFacts([frame(0, { face: face(0.3) }), frame(125, { face: face(0.3) })], cfg)).toContain('趨勢不明')
  })

  it('掉幀在寬限內不中斷持續時間', () => {
    const fs = [...approach(0, 500, 0.3, 0.3), frame(625), frame(750), ...approach(875, 500, 0.3, 0.3)]
    expect(summarizeFacts(fs, cfg)?.face?.presentMs).toBe(fs.at(-1)!.t)
  })

  it('掉幀超過寬限，持續時間重新計算', () => {
    const fs = [...approach(0, 500, 0.3, 0.3), frame(625), frame(750), frame(875), frame(1000), ...approach(1125, 500, 0.3, 0.3)]
    expect(summarizeFacts(fs, cfg)?.face?.presentMs).toBe(500)
  })

  it('一直在場超過緩衝區長度時標示「以上」', () => {
    const fs = approach(0, 6000, 0.3, 0.3).filter((f) => f.t >= 1000)
    expect(serializeFacts(fs, cfg)).toContain('已持續 5.0 秒以上')
  })

  it('臉消失：回報消失多久', () => {
    const fs = [...approach(0, 500, 0.3, 0.3), frame(1100)]
    expect(serializeFacts(fs, cfg)).toBe('沒有偵測到臉（已消失 0.6 秒）；未追蹤手部')
  })

  it('緩衝區內都沒有臉', () => {
    expect(serializeFacts([frame(0), frame(125)], cfg)).toBe('沒有偵測到臉（5.0 秒內都沒有）；未追蹤手部')
  })

  it('揮手：折返次數、擺幅、手勢', () => {
    const text = serializeFacts(waving(0, 1000, 0.18), cfg)!
    expect(text).toMatch(/^臉寬比 0\.32，已持續 1\.0 秒，趨勢穩定；手腕在 \d\.\d 秒內水平折返 \d 次，擺幅 0\.1\d；目前手勢 Open_Palm（0\.92）$/)
  })

  it('手勢追蹤開著但沒有手', () => {
    expect(serializeFacts([frame(0, { face: face(0.3), handTracking: true })], cfg)).toContain('沒有偵測到手')
  })

  it('手靜止：沒有折返、沒有手勢分類', () => {
    const fs = frames(0, 1000, 12).map((t) => frame(t, { handTracking: true, hand: { ...hand(0.5), gesture: null } }))
    expect(serializeFacts(fs, cfg)).toBe('沒有偵測到臉（5.0 秒內都沒有）；手腕沒有水平折返；沒有可辨識的手勢')
  })

  it('相同輸入輸出相同文字（格式穩定）', () => {
    const fs = waving(0, 1000, 0.18)
    expect(serializeFacts(fs, cfg)).toBe(serializeFacts([...fs], cfg))
  })

  it('輸出精簡：完整描述在 80 字內', () => {
    expect(serializeFacts(waving(0, 1000, 0.18), cfg)!.length).toBeLessThanOrEqual(80)
  })
})

describe('createFactWindow', () => {
  it('只保留最近 windowMs 的事實', () => {
    const w = createFactWindow(1000)
    for (const t of [0, 400, 800, 1200, 1600]) w.push(frame(t))
    expect(w.frames.map((f) => f.t)).toEqual([800, 1200, 1600])
  })
})
