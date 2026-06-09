import { describe, it, expect } from 'vitest'
import { matchesAccel } from './keymatch'

const ev = (key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods }) as KeyboardEvent

describe('matchesAccel', () => {
  it('matches a ctrl+shift+letter accelerator', () => {
    expect(matchesAccel(ev('B', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+B')).toBe(true)
  })

  it('is case-insensitive on the key', () => {
    expect(matchesAccel(ev('b', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+B')).toBe(true)
  })

  it('requires every modifier to match exactly (no extra, no missing)', () => {
    expect(matchesAccel(ev('B', { ctrlKey: true }), 'Ctrl+Shift+B')).toBe(false) // missing shift
    expect(matchesAccel(ev('B', { ctrlKey: true, shiftKey: true, metaKey: true }), 'Ctrl+Shift+B')).toBe(false) // extra meta
  })

  it('handles named keys (Enter) and Meta/Cmd aliases', () => {
    expect(matchesAccel(ev('Enter', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Enter')).toBe(true)
    expect(matchesAccel(ev('t', { metaKey: true }), 'Cmd+T')).toBe(true)
  })

  it('returns false for an empty accelerator', () => {
    expect(matchesAccel(ev('B', { ctrlKey: true, shiftKey: true }), '')).toBe(false)
  })
})
