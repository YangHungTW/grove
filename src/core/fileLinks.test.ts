import { describe, it, expect } from 'vitest'
import { findFileLinks } from './fileLinks'

describe('findFileLinks', () => {
  it('matches a bare markdown/html filename', () => {
    expect(findFileLinks('see README.md for details')).toEqual([
      { path: 'README.md', index: 4, length: 9 }
    ])
    expect(findFileLinks('open docs/index.html')).toEqual([
      { path: 'docs/index.html', index: 5, length: 15 }
    ])
  })

  it('matches relative and ~ paths', () => {
    expect(findFileLinks('edited src/core/userPath.md')[0]).toEqual({
      path: 'src/core/userPath.md',
      index: 7,
      length: 20
    })
    expect(findFileLinks('~/notes/todo.md')[0]).toEqual({
      path: '~/notes/todo.md',
      index: 0,
      length: 15
    })
  })

  it('keeps a :line[:col] suffix in the range but not in path', () => {
    const [m] = findFileLinks('error at README.md:42:7 here')
    expect(m.path).toBe('README.md')
    // range covers "README.md:42:7"
    expect('error at README.md:42:7 here'.slice(m.index, m.index + m.length)).toBe('README.md:42:7')
  })

  it('finds multiple links on one line', () => {
    const ms = findFileLinks('a.md and b.html')
    expect(ms.map((m) => m.path)).toEqual(['a.md', 'b.html'])
  })

  it('does not match other extensions', () => {
    expect(findFileLinks('script.ts and image.png')).toEqual([])
  })

  it('matches .markdown and .htm', () => {
    expect(findFileLinks('x.markdown y.htm').map((m) => m.path)).toEqual(['x.markdown', 'y.htm'])
  })

  it('returns nothing for a line with no paths', () => {
    expect(findFileLinks('just some prose without files')).toEqual([])
  })
})
