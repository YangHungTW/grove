import { describe, expect, it } from 'vitest'
import { formatTokens, formatUsd, shortModel, sumUsage } from './usageFormat'
import type { WorktreeUsage } from '../core/agentUsage'

describe('formatTokens', () => {
  it('keeps small counts literal and abbreviates k/M', () => {
    expect(formatTokens(812)).toBe('812')
    expect(formatTokens(4_530)).toBe('4.5k')
    expect(formatTokens(45_300)).toBe('45k')
    expect(formatTokens(1_240_000)).toBe('1.2M')
  })
})

describe('formatUsd', () => {
  it('shows cents and floors tiny amounts', () => {
    expect(formatUsd(1.234)).toBe('$1.23')
    expect(formatUsd(0.05)).toBe('$0.05')
    expect(formatUsd(0.001)).toBe('<$0.01')
  })
})

describe('shortModel', () => {
  it('shortens known families with versions', () => {
    expect(shortModel('claude-opus-4-8')).toBe('opus 4.8')
    expect(shortModel('claude-sonnet-4-6')).toBe('sonnet 4.6')
    expect(shortModel('claude-fable-5')).toBe('fable 5')
  })
  it('drops trailing date stamps', () => {
    expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
  })
  it('passes unknown ids through without the claude- prefix', () => {
    expect(shortModel('claude-next-thing')).toBe('next-thing')
  })
})

describe('sumUsage', () => {
  const wt = (over: Partial<WorktreeUsage>): WorktreeUsage => ({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costUsd: null,
    model: 'claude-opus-5',
    contextTokens: 0,
    lastTs: 0,
    sessions: 1,
    ...over
  })

  it('adds up tokens, dollars, sessions and worktrees', () => {
    const total = sumUsage([
      wt({ input: 100, output: 20, cacheRead: 5, cacheWrite: 1, costUsd: 0.5, sessions: 2 }),
      wt({ input: 300, output: 40, cacheRead: 0, cacheWrite: 4, costUsd: 1.25, sessions: 3 })
    ])
    expect(total).toEqual({ tokens: 470, costUsd: 1.75, sessions: 5, worktrees: 2, unpriced: 0 })
  })

  it('prices only what HAS a price — an unpriced model must not read as free', () => {
    // A model missing from the price table contributes tokens but no dollars.
    // Counting it as $0 would under-report the day's spend without saying so.
    const total = sumUsage([
      wt({ input: 100, costUsd: 2 }),
      wt({ input: 900, costUsd: null })
    ])
    expect(total.tokens).toBe(1000)
    expect(total.costUsd).toBe(2)
    // ...and the total must be able to SAY that it left work out.
    expect(total.unpriced).toBe(1)
  })

  it('reports no cost at all when nothing was priced', () => {
    expect(sumUsage([wt({ input: 10 })]).costUsd).toBeNull()
  })

  it('is empty, not zero-cost, with no worktrees', () => {
    expect(sumUsage([])).toEqual({ tokens: 0, costUsd: null, sessions: 0, worktrees: 0, unpriced: 0 })
  })
})
