import { describe, it, expect } from 'vitest'
import { dedupeByDurableKey } from './layoutDedupe'
import type { SessionDescriptor } from './layoutStore'

const agent = (durableKey?: string, title = 'claude'): SessionDescriptor => ({
  repoRoot: '/a',
  worktreePath: '/a',
  kind: 'agent',
  title,
  icon: '★',
  durableKey
})

describe('dedupeByDurableKey — self-heal a double-spawned layout', () => {
  it('drops later descriptors sharing a durableKey, keeping the first', () => {
    const out = dedupeByDurableKey([agent('k1', 'first'), agent('k1', 'dup'), agent('k2')])
    expect(out).toHaveLength(2)
    expect(out[0].title).toBe('first')
    expect(out.map((d) => d.durableKey)).toEqual(['k1', 'k2'])
  })

  it('keeps every descriptor WITHOUT a durableKey (shells are repeatable)', () => {
    const shell = (): SessionDescriptor => ({
      repoRoot: '/a',
      worktreePath: '/a',
      kind: 'shell',
      title: 'shell'
    })
    const out = dedupeByDurableKey([shell(), shell(), agent('k1'), agent('k1')])
    expect(out).toHaveLength(3) // two shells + one deduped agent
  })

  it('leaves an already-clean layout untouched', () => {
    const clean = [agent('k1'), agent('k2'), agent('k3')]
    expect(dedupeByDurableKey(clean)).toEqual(clean)
  })
})
