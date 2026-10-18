import { describe, expect, it } from 'vitest'
import type { PresenceConfig } from '~/lib/judgment/config'
import {
  initialPresence,
  stepPresence,
  usePresenceStateMachine,
  type PresenceState,
  type PresenceTransition,
} from '~/lib/judgment/usePresenceStateMachine'
import type { FaceFact } from '~/lib/perception/types'
import { face, frames } from './helpers/facts'

const cfg: PresenceConfig = {
  enterRatio: 0.22,
  exitRatio: 0.17,
  dwellMs: 1000,
  greetHoldMs: 2000,
  absentMs: 1500,
  faceLostGraceMs: 400,
}

/** 用同一份臉部事實餵一段時間，回傳最終狀態與期間所有轉移 */
function feed(s: PresenceState, ts: number[], f: FaceFact | null) {
  const transitions: PresenceTransition[] = []
  for (const t of ts) {
    const next = stepPresence(s, { t, face: f }, cfg)
    s = next.state
    transitions.push(...next.transitions)
  }
  return { state: s, transitions }
}

/** 從 idle 走到 approaching */
function approached(t = 0): PresenceState {
  return stepPresence(initialPresence(t), { t, face: face(0.3) }, cfg).state
}

describe('stepPresence', () => {
  it('臉太小或沒有臉時維持 idle', () => {
    expect(feed(initialPresence(0), frames(0, 3000, 8), face(0.15)).transitions).toEqual([])
    expect(feed(initialPresence(0), frames(0, 3000, 8), null).transitions).toEqual([])
  })

  it('臉寬比達到 enterRatio 進入 approaching', () => {
    const { state, transitions } = stepPresence(initialPresence(0), { t: 100, face: face(0.22) }, cfg)
    expect(state.phase).toBe('approaching')
    expect(state.phaseSince).toBe(100)
    expect(transitions).toEqual([{ from: 'idle', to: 'approaching', reason: 'near', t: 100 }])
  })

  it('approaching 持續滿 dwellMs 才 greeted', () => {
    const before = feed(approached(0), frames(125, 874, 8), face(0.3))
    expect(before.state.phase).toBe('approaching')
    const after = stepPresence(before.state, { t: 1000, face: face(0.3) }, cfg)
    expect(after.state.phase).toBe('greeted')
    expect(after.transitions[0]?.reason).toBe('dwell')
  })

  it('遲滯：臉寬比在 exitRatio 與 enterRatio 之間仍維持 approaching 並計時', () => {
    const { state } = feed(approached(0), frames(125, 1000, 8), face(0.19))
    expect(state.phase).toBe('greeted')
  })

  it('路過：dwell 前臉寬比掉到 exitRatio 以下就回 idle', () => {
    const { state, transitions } = feed(approached(0), [125, 250, 375], face(0.12))
    expect(state.phase).toBe('idle')
    expect(transitions).toEqual([{ from: 'approaching', to: 'idle', reason: 'too-far', t: 125 }])
  })

  it('掉幀寬限內不算離開，dwell 計時不中斷', () => {
    let s = feed(approached(0), [125, 250], face(0.3)).state
    s = feed(s, [375, 500, 625], null).state // 消失 375ms，未超過 400ms 寬限
    expect(s.phase).toBe('approaching')
    s = feed(s, frames(750, 250, 8), face(0.3)).state
    expect(s.phase).toBe('greeted')
  })

  it('臉消失超過寬限就回 idle', () => {
    const s = feed(approached(0), [125], face(0.3)).state
    const { state, transitions } = feed(s, [250, 375, 500, 625], null)
    expect(state.phase).toBe('idle')
    expect(transitions[0]).toEqual({ from: 'approaching', to: 'idle', reason: 'face-lost', t: 625 })
  })

  it('greeted 顯示滿 greetHoldMs 後進 cooldown', () => {
    const greeted: PresenceState = { phase: 'greeted', phaseSince: 0, lastNearAt: 0, ratio: 0.3 }
    expect(stepPresence(greeted, { t: 1999, face: face(0.3) }, cfg).state.phase).toBe('greeted')
    const next = stepPresence(greeted, { t: 2000, face: face(0.3) }, cfg)
    expect(next.state.phase).toBe('cooldown')
    expect(next.transitions[0]?.reason).toBe('hold-elapsed')
  })

  describe('cooldown', () => {
    const cooling: PresenceState = { phase: 'cooldown', phaseSince: 0, lastNearAt: 0, ratio: 0.3 }

    it('人一直待著就一直冷卻，不會重複問候', () => {
      expect(feed(cooling, frames(0, 10_000, 8), face(0.3)).transitions).toEqual([])
    })

    it('人離開滿 absentMs 才回 idle', () => {
      const { state, transitions } = feed(cooling, frames(125, 1500, 8), null)
      expect(state.phase).toBe('idle')
      expect(transitions).toEqual([{ from: 'cooldown', to: 'idle', reason: 'away', t: 1500 }])
    })

    it('退到遠處（臉還在但很小）也算離開', () => {
      expect(feed(cooling, frames(125, 1500, 8), face(0.1)).state.phase).toBe('idle')
    })

    it('短暫離開又回來，離開計時重新算', () => {
      let s = feed(cooling, frames(125, 1000, 8), null).state
      s = feed(s, [1250], face(0.3)).state
      s = feed(s, frames(1375, 1300, 8), null).state
      expect(s.phase).toBe('cooldown')
    })
  })
})

describe('usePresenceStateMachine', () => {
  it('完整走一輪 idle → approaching → greeted → cooldown → idle', () => {
    const machine = usePresenceStateMachine(cfg)
    const seen: string[] = []
    const run = (ts: number[], f: FaceFact | null) => {
      for (const t of ts) for (const tr of machine.update({ t, face: f })) seen.push(tr.to)
    }
    run(frames(0, 3500, 8), face(0.3))
    run(frames(3625, 2000, 8), null)
    expect(seen).toEqual(['approaching', 'greeted', 'cooldown', 'idle'])
    expect(machine.state.phase).toBe('idle')
  })
})
