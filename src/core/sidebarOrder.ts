/**
 * Pure ordering helpers for the sidebar's drag-to-reorder (project groups, and
 * the worktree cards inside a project). Ids are the existing stable ones: repo
 * roots for projects, worktree paths for cards.
 */

/**
 * Order `ids` by a persisted `order` list: ids named in `order` come first, in
 * that order, and anything unknown keeps its incoming relative order and is
 * appended. Appending (rather than interleaving) is what makes the arrangement
 * stable — a project opened after the order was saved, or a worktree created
 * outside Grove, shows up at the end instead of displacing arranged entries.
 * Stale ids in `order` (a closed project, a removed worktree) are ignored.
 */
export function sortByOrder(ids: string[], order: string[] | undefined): string[] {
  if (!order?.length) return [...ids]
  const have = new Set(ids)
  const known = order.filter((id) => have.has(id))
  const placed = new Set(known)
  return [...known, ...ids.filter((id) => !placed.has(id))]
}

/**
 * Move `dragId` so it sits immediately before `beforeId`, or to the end when
 * `beforeId` is omitted (a drop on empty space below the list). Returns a new
 * array; a no-op drag — onto itself, or involving an id not in the list —
 * returns the list unchanged.
 */
export function moveBefore(ids: string[], dragId: string, beforeId?: string): string[] {
  if (!ids.includes(dragId) || dragId === beforeId) return [...ids]
  if (beforeId !== undefined && !ids.includes(beforeId)) return [...ids]
  const rest = ids.filter((id) => id !== dragId)
  const at = beforeId === undefined ? -1 : rest.indexOf(beforeId)
  rest.splice(at < 0 ? rest.length : at, 0, dragId)
  return rest
}

/** Rebuild a Map in `ids` order, dropping ids it doesn't contain. Insertion
 * order IS the render order for the sidebar's Maps, so this is how a reorder
 * takes effect. */
export function reorderMap<T>(map: Map<string, T>, ids: string[]): Map<string, T> {
  const next = new Map<string, T>()
  for (const id of sortByOrder([...map.keys()], ids)) {
    const v = map.get(id)
    if (v !== undefined) next.set(id, v)
  }
  return next
}
