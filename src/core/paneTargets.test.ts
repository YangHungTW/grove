import { describe, it, expect } from 'vitest'
import { resolveTarget, sendGuard, type PaneRef } from './paneTargets'

const pane = (over: Partial<PaneRef> = {}): PaneRef => ({
  id: 's1',
  title: 'claude',
  worktree: '/wt/api',
  state: 'idle',
  ...over
})

describe('resolveTarget', () => {
  const panes = [
    pane(),
    pane({ id: 's2', title: 'claude', worktree: '/wt/ui' }), // duplicate default title
    pane({ id: 's3', title: 'reviewer', worktree: '/wt/api' })
  ]

  it('an id always wins, even when it looks nothing like a title', () => {
    expect(resolveTarget('s2', panes)).toEqual({ pane: panes[1] })
  })

  it('a unique title resolves', () => {
    expect(resolveTarget('reviewer', panes)).toEqual({ pane: panes[2] })
  })

  it('refuses a duplicate title instead of silently picking the first pane', () => {
    // Every worktree's first agent is titled "claude" — first-match delivery
    // would message the wrong agent with no error anywhere.
    const r = resolveTarget('claude', panes)
    expect('error' in r && r.error).toContain('2 panes')
    expect('error' in r && r.error).toContain('s1')
    expect('error' in r && r.error).toContain('s2')
    expect('error' in r && r.error).toContain('by id')
  })

  it('points an unknown target at list_sessions', () => {
    const r = resolveTarget('nope', panes)
    expect('error' in r && r.error).toContain('list_sessions')
  })
})

describe('sendGuard', () => {
  it('allows busy and idle — the two states where input reads as a message', () => {
    expect(sendGuard(pane({ state: 'idle' }))).toBeNull()
    expect(sendGuard(pane({ state: 'busy' }))).toBeNull()
  })

  it('refuses a waiting pane — Enter would confirm its open dialog', () => {
    // send_to appends \r. A pane on a permission dialog reads that as
    // "confirm the selected option": a remote agent approving another pane's
    // pending permission. The refusal must say WHY so the caller can react.
    const why = sendGuard(pane({ state: 'waiting', waitingFor: 'dialog open' }))
    expect(why).toContain('waiting on the USER')
    expect(why).toContain('dialog open')
  })

  it('refuses a waiting pane even with no recorded reason', () => {
    expect(sendGuard(pane({ state: 'waiting' }))).toContain('input needed')
  })

  it('refuses a starting pane — input would run as a shell command', () => {
    // Before the agent bootstrap types its command, the pane is a bare
    // interactive shell; injected text + Enter would EXECUTE there.
    expect(sendGuard(pane({ state: 'starting' }))).toContain('SHELL COMMAND')
  })

  it('refuses an exited pane', () => {
    expect(sendGuard(pane({ state: 'exited' }))).toContain('exited')
  })
})
