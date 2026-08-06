import { describe, it, expect } from 'vitest'
import { timeAgo } from './timeAgo'

const NOW = 1_700_000_000_000
const ago = (ms: number): string => timeAgo(NOW - ms, NOW)

describe('timeAgo', () => {
  it('collapses anything under a minute to "just now"', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(59_000)).toBe('just now')
  })

  it('steps up through minutes, hours, and days', () => {
    expect(ago(90_000)).toBe('2m ago')
    expect(ago(3 * 3600_000)).toBe('3h ago')
    expect(ago(50 * 3600_000)).toBe('2d ago')
  })

  it('never reports a negative age for a clock that ran backwards', () => {
    expect(timeAgo(NOW + 60_000, NOW)).toBe('just now')
  })
})
