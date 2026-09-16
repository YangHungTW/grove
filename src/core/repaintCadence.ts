/**
 * When a streaming pane is due a full repaint (Electron-free).
 *
 * An agent rewrites its status/cost row IN PLACE, and xterm's renderers can
 * leave the old glyphs on screen when it does: the row shows a stale value, and
 * where the new text is longer than the old, the cells past the old end come out
 * as solid blocks. The buffer is correct throughout — dragging a selection over
 * the row reveals the real text — so this is the renderer holding a cached model
 * of cells it believes it has already drawn.
 *
 * A plain `refresh()` does not dislodge that; clearing the renderer's atlas and
 * model does. Grove schedules that clear on a trailing debounce, which is right
 * for a pane that goes quiet — but a pane that is STREAMING resets the debounce
 * on every chunk, and chunks from a live TUI arrive far closer together than the
 * settle window. The repair was therefore never reaching exactly the panes that
 * needed it, for as long as they kept talking.
 *
 * So the deferral gets a ceiling. Quiet panes still repair on the settle; a
 * streaming pane repairs on a bounded cadence instead of never.
 */

/** How quiet a pane must go before its full repaint runs. */
export const ATLAS_SETTLE_MS = 180

/**
 * The longest a pane may keep deferring that repaint by talking.
 *
 * This is a cost/latency trade, and it has history: 0.9.2 capped the deferral at
 * ~2.5 repairs a second, concluded it had not fixed the garbled row, and removed
 * the cap as pure overhead. What that attempt was missing is that the garbled row
 * needs the atlas AND model cleared — which the cap did do — but the reasoning at
 * the time blamed the renderer and stopped there. One repair a second is a
 * quarter of that cost and still bounds how long a wrong number can sit on screen.
 */
export const ATLAS_MAX_DEFER_MS = 1_000

/**
 * How long to wait before the next full repaint of a pane that just produced
 * output, given when it first started deferring one.
 *
 * Normally the settle window, so a pane that stops talking repairs promptly and
 * only once. Never later than the ceiling measured from the first deferral, so a
 * pane that never stops talking still repairs. Never negative — an overdue pane
 * repairs on the next tick rather than being skipped.
 */
export function nextAtlasClearDelay(
  deferringSinceMs: number,
  now: number,
  settleMs: number = ATLAS_SETTLE_MS,
  maxDeferMs: number = ATLAS_MAX_DEFER_MS
): number {
  const dueBy = deferringSinceMs + maxDeferMs
  return Math.max(0, Math.min(settleMs, dueBy - now))
}
