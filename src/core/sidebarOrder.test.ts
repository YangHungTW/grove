import { describe, it, expect } from 'vitest'
import { sortByOrder, moveBefore, reorderMap } from './sidebarOrder'

describe('sortByOrder — applying a saved sidebar arrangement', () => {
  it('returns the incoming order when nothing is saved', () => {
    expect(sortByOrder(['a', 'b', 'c'], undefined)).toEqual(['a', 'b', 'c'])
    expect(sortByOrder(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c'])
  })

  it('orders known ids by the saved list', () => {
    expect(sortByOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b'])
  })

  it('appends ids the saved order has never seen, keeping their relative order', () => {
    expect(sortByOrder(['a', 'new1', 'b', 'new2'], ['b', 'a'])).toEqual(['b', 'a', 'new1', 'new2'])
  })

  it('ignores stale ids (a closed project / removed worktree)', () => {
    expect(sortByOrder(['a', 'b'], ['gone', 'b', 'also-gone', 'a'])).toEqual(['b', 'a'])
  })

  it('does not mutate its input', () => {
    const ids = ['a', 'b']
    sortByOrder(ids, ['b', 'a'])
    expect(ids).toEqual(['a', 'b'])
  })
})

describe('moveBefore — one drag-and-drop', () => {
  it('inserts the dragged id before the drop target', () => {
    expect(moveBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(moveBefore(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c'])
  })

  it('appends when there is no target (dropped past the last row)', () => {
    expect(moveBefore(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
  })

  it('is a no-op when dropped on itself', () => {
    expect(moveBefore(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c'])
  })

  it('is a no-op for an unknown dragged id or unknown target', () => {
    expect(moveBefore(['a', 'b'], 'zz', 'a')).toEqual(['a', 'b'])
    expect(moveBefore(['a', 'b'], 'a', 'zz')).toEqual(['a', 'b'])
  })

  it('does not mutate its input', () => {
    const ids = ['a', 'b', 'c']
    moveBefore(ids, 'c', 'a')
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

describe('reorderMap — insertion order is render order', () => {
  it('rebuilds the map in the given order', () => {
    const m = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ])
    expect([...reorderMap(m, ['c', 'b', 'a']).keys()]).toEqual(['c', 'b', 'a'])
  })

  it('keeps entries the order omits, at the end', () => {
    const m = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ])
    const out = reorderMap(m, ['c'])
    expect([...out.keys()]).toEqual(['c', 'a', 'b'])
    expect(out.get('a')).toBe(1)
  })

  it('drops ids the map does not have', () => {
    const out = reorderMap(new Map([['a', 1]]), ['gone', 'a'])
    expect([...out.keys()]).toEqual(['a'])
  })
})
