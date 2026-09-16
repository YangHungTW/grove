import { describe, expect, it } from 'vitest'
import { nextAtlasClearDelay, ATLAS_SETTLE_MS, ATLAS_MAX_DEFER_MS } from './repaintCadence'

describe('nextAtlasClearDelay', () => {
  it('waits the settle window for a pane that has only just started deferring', () => {
    const t0 = 10_000
    expect(nextAtlasClearDelay(t0, t0)).toBe(ATLAS_SETTLE_MS)
  })

  it('never lets a talking pane push the repair past the ceiling', () => {
    // This is the bug in one line: a live TUI emits faster than the settle
    // window, so a plain trailing debounce is reset forever and the repair
    // never runs on exactly the pane that needs it.
    const t0 = 10_000
    const nearlyDue = t0 + ATLAS_MAX_DEFER_MS - 50
    expect(nextAtlasClearDelay(t0, nearlyDue)).toBe(50)
  })

  it('repairs on the next tick once overdue, rather than skipping', () => {
    const t0 = 10_000
    expect(nextAtlasClearDelay(t0, t0 + ATLAS_MAX_DEFER_MS)).toBe(0)
    expect(nextAtlasClearDelay(t0, t0 + ATLAS_MAX_DEFER_MS + 5_000)).toBe(0)
  })

  it('still prefers the settle window whenever it lands first', () => {
    // A pane that goes quiet must not be made to wait for the ceiling.
    const t0 = 10_000
    expect(nextAtlasClearDelay(t0, t0 + 100)).toBe(ATLAS_SETTLE_MS)
  })

  it('bounds how long a wrong value can stay on screen', () => {
    // Whatever the tuning, a streaming pane must repair inside the ceiling.
    const t0 = 0
    let now = 0
    let waited = 0
    // Simulate chunks arriving every 50ms — well inside the settle window.
    for (let i = 0; i < 100; i++) {
      waited = nextAtlasClearDelay(t0, now)
      if (waited === 0) break
      now += Math.min(50, waited)
    }
    expect(now).toBeLessThanOrEqual(ATLAS_MAX_DEFER_MS)
  })
})
