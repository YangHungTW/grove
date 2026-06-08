import { describe, it, expect, beforeEach } from 'vitest'
import { SessionRegistry, SingleAgentError } from './sessionRegistry'

describe('SessionRegistry — one worktree holds N sessions, one primary agent', () => {
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
    // ids are unique and assigned
    expect(a.id).not.toEqual(b.id)
  })

  it('rejects a second agent in the same worktree (single primary agent)', () => {
    const wt = 'wt-1'
    reg.addSession({ worktreeId: wt, kind: 'agent', title: 'claude' })
    expect(() => reg.addSession({ worktreeId: wt, kind: 'agent', title: 'codex' })).toThrow(
      SingleAgentError
    )
  })

  it('allows unbounded auxiliary sessions alongside the one agent', () => {
    const wt = 'wt-1'
    reg.addSession({ worktreeId: wt, kind: 'agent' })
    for (let i = 0; i < 5; i++) reg.addSession({ worktreeId: wt, kind: 'shell' })
    reg.addSession({ worktreeId: wt, kind: 'server' })
    reg.addSession({ worktreeId: wt, kind: 'task' })

    const sessions = reg.getSessions(wt)
    expect(sessions).toHaveLength(8)
    expect(sessions.filter((s) => s.kind === 'agent')).toHaveLength(1)
  })

  it('a different worktree may have its own agent', () => {
    reg.addSession({ worktreeId: 'wt-1', kind: 'agent' })
    expect(() => reg.addSession({ worktreeId: 'wt-2', kind: 'agent' })).not.toThrow()
  })

  it('removeSession drops it; getSession reflects removal', () => {
    const wt = 'wt-1'
    const a = reg.addSession({ worktreeId: wt, kind: 'shell' })
    expect(reg.getSession(a.id)).toBeDefined()
    reg.removeSession(a.id)
    expect(reg.getSession(a.id)).toBeUndefined()
    expect(reg.getSessions(wt)).toHaveLength(0)
  })

  it('allows a new agent after the previous agent is removed', () => {
    const wt = 'wt-1'
    const agent = reg.addSession({ worktreeId: wt, kind: 'agent' })
    reg.removeSession(agent.id)
    expect(() => reg.addSession({ worktreeId: wt, kind: 'agent' })).not.toThrow()
  })
})
