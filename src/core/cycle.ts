/** Wrap-around index for prev/next cycling (tabs, worktrees, projects).
 * Pure (no Node/DOM) so it's unit-testable and shared across cyclers.
 *
 * Moves `delta` steps from `current`, wrapping past either end. A `current` of
 * -1 (item not found) is treated as 0 so the first step lands sensibly. Returns
 * -1 for an empty list. */
export function wrapIndex(current: number, delta: number, len: number): number {
  if (len <= 0) return -1
  const base = current < 0 ? 0 : current
  return (((base + delta) % len) + len) % len
}
