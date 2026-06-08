import { describe, it, expect, beforeEach } from 'vitest'
import { SessionRegistry } from './sessionRegistry'

describe('SessionRegistry — multiple sessions (incl. multiple agents) per worktree', () => {
  let reg: SessionRegistry

  beforeEach(() => {
    reg = new SessionRegistry()
  })

  it('holds multiple sessions for a single worktree', () => {
    const wt = 'wt-1'
    const a = reg.addSession({ worktreeId: wt, kind: 'agent', title: 'claude' })
    const b = reg.addSession({ worktreeId: wt, kind: 'shell', title: 'zsh' })

    const sessions = reg.getSessions(wt)
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.id).sort()).toEqual([a.id, b.id].sort())
    expect(a.id).not.toEqual(b.id)
  })

  it('allows MULTIPLE agents in the same worktree', () => {
    const wt = 'wt-1'
    reg.addSession({ worktreeId: wt, kind: 'agent' })
    reg.addSession({ worktreeId: wt, kind: 'agent' })
    reg.addSession({ worktreeId: wt, kind: 'agent' })
    expect(reg.getSessions(wt).filter((s) => s.kind === 'agent')).toHaveLength(3)
  })

  it('mixes agents and shells without limit', () => {
    const wt = 'wt-1'
    reg.addSession({ worktreeId: wt, kind: 'agent' })
    reg.addSession({ worktreeId: wt, kind: 'agent' })
    for (let i = 0; i < 4; i++) reg.addSession({ worktreeId: wt, kind: 'shell' })
    expect(reg.getSessions(wt)).toHaveLength(6)
  })

  it('keeps sessions of different worktrees separate', () => {
    reg.addSession({ worktreeId: 'wt-1', kind: 'agent' })
    reg.addSession({ worktreeId: 'wt-2', kind: 'agent' })
    expect(reg.getSessions('wt-1')).toHaveLength(1)
    expect(reg.getSessions('wt-2')).toHaveLength(1)
  })

  it('removeSession drops it; getSession reflects removal', () => {
    const wt = 'wt-1'
    const a = reg.addSession({ worktreeId: wt, kind: 'shell' })
    expect(reg.getSession(a.id)).toBeDefined()
    reg.removeSession(a.id)
    expect(reg.getSession(a.id)).toBeUndefined()
    expect(reg.getSessions(wt)).toHaveLength(0)
  })
})
