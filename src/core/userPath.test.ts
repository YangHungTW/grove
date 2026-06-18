import { describe, it, expect } from 'vitest'
import { resolveUserPath } from './userPath'

const CWD = '/Users/me/Tools/grove-wt-feature'
const HOME = '/Users/me'

describe('resolveUserPath', () => {
  it('resolves a relative path against the worktree cwd', () => {
    expect(resolveUserPath(CWD, 'docs/readme.md', HOME)).toBe(`${CWD}/docs/readme.md`)
    expect(resolveUserPath(CWD, './notes.md', HOME)).toBe(`${CWD}/notes.md`)
    expect(resolveUserPath(CWD, '../sibling/x.md', HOME)).toBe('/Users/me/Tools/sibling/x.md')
  })

  it('leaves an absolute path absolute (normalized)', () => {
    expect(resolveUserPath(CWD, '/etc/hosts', HOME)).toBe('/etc/hosts')
    expect(resolveUserPath(CWD, '/a/b/../c', HOME)).toBe('/a/c')
  })

  it('expands a leading ~', () => {
    expect(resolveUserPath(CWD, '~', HOME)).toBe(HOME)
    expect(resolveUserPath(CWD, '~/docs/x.md', HOME)).toBe(`${HOME}/docs/x.md`)
  })

  it('strips surrounding whitespace and a wrapping quote pair', () => {
    expect(resolveUserPath(CWD, '  docs/readme.md  ', HOME)).toBe(`${CWD}/docs/readme.md`)
    expect(resolveUserPath(CWD, '"docs/readme.md"', HOME)).toBe(`${CWD}/docs/readme.md`)
    expect(resolveUserPath(CWD, "'/etc/hosts'", HOME)).toBe('/etc/hosts')
  })

  it('handles a file:// URI', () => {
    expect(resolveUserPath(CWD, 'file:///etc/hosts', HOME)).toBe('/etc/hosts')
    expect(resolveUserPath(CWD, 'file:///a/b%20c.md', HOME)).toBe('/a/b c.md')
  })

  it('returns empty for blank input', () => {
    expect(resolveUserPath(CWD, '   ', HOME)).toBe('')
  })
})
