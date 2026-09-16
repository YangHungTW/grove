import { describe, expect, it, vi } from 'vitest'
import { mergeUsage, worktreeAgentUsage, type UsageProvider } from './agentUsage'
import type { WorktreeUsage } from './usageTypes'

const usage = (over: Partial<WorktreeUsage>): WorktreeUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUsd: null,
  model: '',
  contextTokens: 0,
  lastTs: 0,
  sessions: 1,
  ...over
})

const provider = (u: WorktreeUsage | null): UsageProvider => vi.fn(async () => u)

describe('mergeUsage', () => {
  it('adds tokens and sessions across agents', () => {
    const m = mergeUsage(
      usage({ input: 10, output: 2, cacheRead: 100, cacheWrite: 5, sessions: 2 }),
      usage({ input: 7, output: 3, cacheRead: 50, cacheWrite: 0, sessions: 1 })
    )
    expect(m).toMatchObject({ input: 17, output: 5, cacheRead: 150, cacheWrite: 5, sessions: 3 })
  })

  it('takes model and context from whichever agent spoke most recently', () => {
    // Context is one conversation's current prompt size, so it is chosen, never
    // added: two agents' contexts summed would be a number that means nothing.
    const m = mergeUsage(
      usage({ model: 'claude-opus-5', contextTokens: 120_000, lastTs: 100 }),
      usage({ model: 'gpt-5.1-codex', contextTokens: 40_000, lastTs: 200 })
    )
    expect(m?.model).toBe('gpt-5.1-codex')
    expect(m?.contextTokens).toBe(40_000)
  })

  it('keeps a priced agent priced when the other has no price table', () => {
    // Codex tokens are known but its dollars are not. The Claude cost must
    // survive the merge, and must not be inflated by treating null as zero.
    const m = mergeUsage(usage({ costUsd: 3.5 }), usage({ costUsd: null }))
    expect(m?.costUsd).toBe(3.5)
  })

  it('stays unpriced when NO agent had a price', () => {
    expect(mergeUsage(usage({ costUsd: null }), usage({ costUsd: null }))?.costUsd).toBeNull()
  })

  it('passes through when one side found nothing', () => {
    const only = usage({ input: 5 })
    expect(mergeUsage(null, only)).toBe(only)
    expect(mergeUsage(only, null)).toBe(only)
    expect(mergeUsage(null, null)).toBeNull()
  })
})

describe('worktreeAgentUsage', () => {
  it('combines every agent that found something', async () => {
    const u = await worktreeAgentUsage('/wt', 0, undefined, [
      provider(usage({ input: 10, model: 'claude-opus-5', lastTs: 1 })),
      provider(usage({ input: 5, model: 'gpt-5.1-codex', lastTs: 2 }))
    ])
    expect(u?.input).toBe(15)
    expect(u?.sessions).toBe(2)
  })

  it('is null when no agent recorded anything', async () => {
    // An agent that keeps no log is not an agent that was free — the caller
    // shows nothing rather than a zero reading.
    expect(await worktreeAgentUsage('/wt', 0, undefined, [provider(null), provider(null)])).toBeNull()
  })

  it('one agent throwing must not blank out the agents that still parse', async () => {
    const broken: UsageProvider = vi.fn(async () => {
      throw new Error('log format changed')
    })
    const u = await worktreeAgentUsage('/wt', 0, undefined, [
      broken,
      provider(usage({ input: 42, model: 'claude-opus-5' }))
    ])
    expect(u?.input).toBe(42)
  })
})
