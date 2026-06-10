import { describe, it, expect } from 'vitest'
import { wrapIndex } from './cycle'

describe('wrapIndex', () => {
  it('steps forward and backward within range', () => {
    expect(wrapIndex(0, 1, 3)).toBe(1)
    expect(wrapIndex(1, 1, 3)).toBe(2)
    expect(wrapIndex(2, -1, 3)).toBe(1)
  })

  it('wraps past either end', () => {
    expect(wrapIndex(2, 1, 3)).toBe(0) // last → first
    expect(wrapIndex(0, -1, 3)).toBe(2) // first → last
  })

  it('treats a not-found current (-1) as 0', () => {
    expect(wrapIndex(-1, 1, 3)).toBe(1)
    expect(wrapIndex(-1, -1, 3)).toBe(2)
  })

  it('handles a single-item list (stays put)', () => {
    expect(wrapIndex(0, 1, 1)).toBe(0)
    expect(wrapIndex(0, -1, 1)).toBe(0)
  })

  it('returns -1 for an empty list', () => {
    expect(wrapIndex(0, 1, 0)).toBe(-1)
  })
})
