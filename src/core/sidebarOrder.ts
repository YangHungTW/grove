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

/** A drop position: an insertion line drawn on one edge of row `id`. */
export type DropSlot = { id: string; edge: 'top' | 'bottom' }

/** A row's vertical extent, as measured from its bounding box. */
export type RowSpan = { id: string; top: number; height: number }

/**
 * The insertion slot for a cursor at `y` over a *list* of rows, rather than over
 * one row: the first row whose midpoint is below the cursor takes the line on
 * its top edge, and a cursor past every midpoint lands on the last row's bottom.
 *
 * Measuring against the whole list is what makes the gaps between rows, the
 * list's own padding, and the empty space below the last row droppable — hit
 * testing row-by-row leaves all of those as dead zones you have to steer around.
 * Returns null for an empty list, where there is nothing to insert relative to.
 */
export function slotAt(y: number, rows: RowSpan[]): DropSlot | null {
  if (!rows.length) return null
  const hit = rows.find((r) => y < r.top + r.height / 2)
  return hit ? { id: hit.id, edge: 'top' } : { id: rows[rows.length - 1].id, edge: 'bottom' }
}

/** The id a `slot` inserts before — the row itself on its top edge, the row
 * after it on its bottom (undefined past the last row = append). */
export function slotBefore(slot: DropSlot, ids: string[]): string | undefined {
  return slot.edge === 'top' ? slot.id : ids[ids.indexOf(slot.id) + 1]
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
