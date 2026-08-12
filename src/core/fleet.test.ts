import { describe, it, expect } from 'vitest'
import { buildAttachCommand, worktreeForCwd } from './fleet'

describe('buildAttachCommand', () => {
  it('builds the attach command for a normal short job id', () => {
    expect(buildAttachCommand('a8e23050')).toBe("claude attach 'a8e23050'")
  })

  it('rejects anything that does not look like a job id', () => {
    // The id comes out of another program's writable state file — a hostile or
    // corrupt value must die here, not inside `$SHELL -ilc`.
    for (const bad of ['', 'a b', 'x;rm -rf ~', '$(whoami)', "a'b", 'x'.repeat(65)])
      expect(buildAttachCommand(bad)).toBeNull()
  })
})

describe('worktreeForCwd', () => {
  const wts = [
    { id: '/repo', path: '/repo' },
    { id: '/repo-wt-feat', path: '/repo-wt-feat' },
    { id: '/other', path: '/other' }
  ]

  it('matches a cwd exactly at the worktree root', () => {
    expect(worktreeForCwd('/repo', wts)).toBe('/repo')
  })

  it('matches a cwd nested inside a worktree', () => {
    expect(worktreeForCwd('/repo/src/deep', wts)).toBe('/repo')
  })

  it('does not confuse a sibling whose name shares a prefix', () => {
    // '/repo-wt-feat' starts with '/repo' as a STRING but is not inside it.
    expect(worktreeForCwd('/repo-wt-feat/src', wts)).toBe('/repo-wt-feat')
  })

  it('prefers the deepest containing worktree', () => {
    const nested = [
      { id: '/a', path: '/a' },
      { id: '/a/wt', path: '/a/wt' }
    ]
    expect(worktreeForCwd('/a/wt/src', nested)).toBe('/a/wt')
  })

  it('returns undefined when nothing contains the cwd', () => {
    expect(worktreeForCwd('/elsewhere/entirely', wts)).toBeUndefined()
  })

  it('tolerates trailing slashes on either side', () => {
    expect(worktreeForCwd('/repo/', wts)).toBe('/repo')
    expect(worktreeForCwd('/x/sub', [{ id: 'w', path: '/x/' }])).toBe('w')
  })
})
