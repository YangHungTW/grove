import { describe, expect, it } from 'vitest'
import {
  shouldRecoverFromProcessGone,
  canRebuildSurface,
  REPAINT_NUDGE_MS,
  SURFACE_REBUILD_COOLDOWN_MS
} from './gpuRecovery'

describe('shouldRecoverFromProcessGone', () => {
  it('recovers when the GPU process dies badly — that is the black window', () => {
    for (const reason of ['crashed', 'killed', 'abnormal-exit', 'oom', 'launch-failed']) {
      expect(shouldRecoverFromProcessGone({ type: 'GPU', reason })).toBe(true)
    }
  })

  it('ignores a GPU process retiring cleanly', () => {
    // Chromium shuts the GPU process down on its own when idle and starts a new
    // one on demand. Treating that as damage would fire a repaint — and a window
    // bounds nudge — on a perfectly healthy idle app.
    expect(shouldRecoverFromProcessGone({ type: 'GPU', reason: 'clean-exit' })).toBe(false)
  })

  it('ignores every process that does not paint', () => {
    for (const type of ['Utility', 'Zygote', 'Sandbox helper', 'Pepper Plugin', 'Unknown']) {
      expect(shouldRecoverFromProcessGone({ type, reason: 'crashed' })).toBe(false)
    }
  })
})

describe('REPAINT_NUDGE_MS', () => {
  it('restores the window well inside the pane resize debounce', () => {
    // PaneGrid holds a pty resize for 120ms before forwarding it. The repair
    // must put the window back before that fires, or fixing a black screen
    // would SIGWINCH every agent into redrawing its whole UI.
    expect(REPAINT_NUDGE_MS).toBeLessThan(120)
  })
})

describe('canRebuildSurface', () => {
  it('rebuilds once per wake, not once per wake SIGNAL', () => {
    // resume, unlock-screen and the macOS activity event all arrive together
    // when a laptop opens. Each rebuild moves the window a pixel, so the burst
    // must collapse to one.
    const t = 1_000_000
    expect(canRebuildSurface(0, t)).toBe(true)
    expect(canRebuildSurface(t, t + 5)).toBe(false)
    expect(canRebuildSurface(t, t + 300)).toBe(false)
  })

  it('allows the next real wake through', () => {
    const t = 1_000_000
    expect(canRebuildSurface(t, t + SURFACE_REBUILD_COOLDOWN_MS)).toBe(true)
  })

  it('allows the very first rebuild of a run', () => {
    expect(canRebuildSurface(0, 0)).toBe(false)
    expect(canRebuildSurface(0, SURFACE_REBUILD_COOLDOWN_MS)).toBe(true)
  })
})
