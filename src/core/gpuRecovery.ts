/**
 * When a dead drawing surface is worth rebuilding (Electron-free).
 *
 * Chromium can lose the window's compositing surface without the app noticing:
 * the machine sleeps, the display sleeps, or the GPU process is killed. Usually
 * Chromium re-creates it. When it does not, every pixel Grove owns stops
 * updating — sidebar included — and nothing in the app is watching, so the only
 * way back is to quit and relaunch.
 *
 * Recovery is not free (it forces a re-composite and a full pane repaint), so it
 * is worth being deliberate about which signals earn one.
 */

/** The shape Electron's `child-process-gone` reports, narrowed to what matters. */
export interface ProcessGone {
  /** 'GPU', 'Utility', 'Zygote', 'Sandbox helper', 'Pepper Plugin', ... */
  type: string
  /** 'clean-exit' | 'abnormal-exit' | 'killed' | 'crashed' | 'oom' | ... */
  reason: string
}

/**
 * Whether a departed child process took the window's drawing surface with it.
 *
 * Only the GPU process paints, so nothing else is worth reacting to — a utility
 * process dying is someone else's problem. A CLEAN exit is also skipped: that is
 * Chromium retiring a process it no longer needs (it does this on idle), not a
 * failure, and treating it as one would fire a repaint storm on an idle app.
 */
export function shouldRecoverFromProcessGone(details: ProcessGone): boolean {
  return details.type === 'GPU' && details.reason !== 'clean-exit'
}

/**
 * How long to hold the window one pixel off its real size before restoring it.
 *
 * `webContents.invalidate()` asks politely for a repaint, and a surface that is
 * genuinely gone can ignore it; changing the window's BOUNDS makes Chromium
 * build a new surface, which is the part that actually works. The nudge must be
 * brief enough that the pane's own resize debounce (120ms, see PaneGrid) never
 * forwards it: the terminal comes back at the size it already had, so no agent
 * is told its window changed and nothing redraws its UI for a repair the user
 * did not ask for.
 */
export const REPAINT_NUDGE_MS = 40

/**
 * The shortest gap between two surface rebuilds.
 *
 * Waking a laptop fires several of these signals at once — `resume` and
 * `unlock-screen` arrive together, and macOS adds its own activity event — and
 * each rebuild moves the window a pixel. One repair per wake is the intent;
 * this collapses the burst without needing to know which signal came first.
 */
export const SURFACE_REBUILD_COOLDOWN_MS = 2_000

/** Whether a rebuild at `now` is far enough from the last one to be worth doing. */
export function canRebuildSurface(lastAtMs: number, now: number): boolean {
  return now - lastAtMs >= SURFACE_REBUILD_COOLDOWN_MS
}
