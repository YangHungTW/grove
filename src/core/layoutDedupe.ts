import type { SessionDescriptor } from './layoutStore'

/**
 * Drop descriptors that share a `durableKey` (keeping the first), which uniquely
 * identifies one durable/tmux agent. A correct layout never has two — but a
 * pre-fix double-spawn (a worktree restored twice) could persist duplicates that
 * both fold onto the SAME `tmux new-session -A` and collapse two panes onto one
 * terminal. De-duping on both restore and save is self-healing: an already-
 * corrupted layout.json converges to one descriptor per durable agent, and can
 * never re-spawn the collision. Descriptors WITHOUT a durableKey (shells,
 * non-durable panes) are legitimately repeatable and always pass through.
 *
 * Kept in its own module (importing only the TYPE from layoutStore) so the
 * renderer can use it without pulling layoutStore's `node:fs` into the browser
 * bundle.
 */
export function dedupeByDurableKey(descriptors: SessionDescriptor[]): SessionDescriptor[] {
  const seen = new Set<string>()
  return descriptors.filter((d) => {
    if (!d.durableKey) return true
    if (seen.has(d.durableKey)) return false
    seen.add(d.durableKey)
    return true
  })
}
