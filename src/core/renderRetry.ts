/**
 * Retry policy for re-acquiring xterm's WebGL renderer after a GPU context loss.
 *
 * Lives in core (not <Pane>) because it is a pure decision — how many times to
 * probe, and how long to wait — that is worth pinning with tests, while the
 * probe itself needs a real DOM canvas and stays in the renderer.
 *
 * Linear rather than exponential backoff: a lost context is normally restored
 * within a second or two (display change, wake from occlusion, driver reset),
 * so the useful window is the first few seconds. Giving up after
 * MAX_WEBGL_RETRIES leaves the pane on the canvas 2D renderer, which is slower
 * but correct — never blank.
 */

/** Attempts before we stop probing and stay on the canvas renderer. */
export const MAX_WEBGL_RETRIES = 5
/** Base delay; attempt N waits N * this. */
export const WEBGL_RETRY_MS = 1000

/** Whether another probe is allowed, given how many have already been made. */
export function canRetryWebgl(attemptsSoFar: number): boolean {
  return attemptsSoFar < MAX_WEBGL_RETRIES
}

/**
 * Delay before the given 1-based attempt. Attempt 1 waits WEBGL_RETRY_MS,
 * attempt 5 waits 5x that — ~15s of total probing before giving up.
 */
export function webglRetryDelay(attempt: number): number {
  return WEBGL_RETRY_MS * Math.max(1, attempt)
}
