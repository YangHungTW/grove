import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorktree, listWorktrees, removeWorktree, isGitRepo } from './worktree'

let repo: string

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ccm-wt-'))
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  writeFileSync(join(repo, 'README.md'), '# temp\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'init'])
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('worktree git operations', () => {
  it('createWorktree then listWorktrees includes the new path + branch', () => {
    const wtPath = join(repo, '..', `wt-${Date.now()}`)
    const info = createWorktree(repo, { path: wtPath, branch: 'feature-x', newBranch: true })
    expect(info.branch).toBe('feature-x')

    const list = listWorktrees(repo)
    const found = list.find((w) => w.branch === 'feature-x')
    expect(found).toBeDefined()
    expect(found!.path).toContain('wt-')

    rmSync(wtPath, { recursive: true, force: true })
  })

  it('listWorktrees includes the primary (main) worktree', () => {
    const list = listWorktrees(repo)
    const main = list.find((w) => w.branch === 'main')
    expect(main).toBeDefined()
  })

  it('isGitRepo is true for a git repo and false for a plain dir', () => {
    expect(isGitRepo(repo)).toBe(true)
    const plain = mkdtempSync(join(tmpdir(), 'ccm-plain-'))
    try {
      expect(isGitRepo(plain)).toBe(false)
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  it('removeWorktree makes it disappear from the list', () => {
    const wtPath = join(repo, '..', `wt-rm-${Date.now()}`)
    createWorktree(repo, { path: wtPath, branch: 'to-remove', newBranch: true })
    expect(listWorktrees(repo).some((w) => w.branch === 'to-remove')).toBe(true)

    removeWorktree(repo, wtPath, { force: true })
    expect(listWorktrees(repo).some((w) => w.branch === 'to-remove')).toBe(false)
  })
})
