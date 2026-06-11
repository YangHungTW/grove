import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  isGitRepo,
  worktreeStatus,
  expandWorktreeTemplate,
  worktreeDiff
} from './worktree'

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
  it('createWorktree then listWorktrees includes the new path + branch', async () => {
    const wtPath = join(repo, '..', `wt-${Date.now()}`)
    const info = await createWorktree(repo, { path: wtPath, branch: 'feature-x', newBranch: true })
    expect(info.branch).toBe('feature-x')

    const list = await listWorktrees(repo)
    const found = list.find((w) => w.branch === 'feature-x')
    expect(found).toBeDefined()
    expect(found!.path).toContain('wt-')

    rmSync(wtPath, { recursive: true, force: true })
  })

  it('listWorktrees includes the primary (main) worktree', async () => {
    const list = await listWorktrees(repo)
    const main = list.find((w) => w.branch === 'main')
    expect(main).toBeDefined()
  })

  it('isGitRepo is true for a git repo and false for a plain dir', async () => {
    expect(await isGitRepo(repo)).toBe(true)
    const plain = mkdtempSync(join(tmpdir(), 'ccm-plain-'))
    try {
      expect(await isGitRepo(plain)).toBe(false)
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  it('worktreeStatus reports dirty count (0 clean, grows with changes)', async () => {
    expect((await worktreeStatus(repo)).dirty).toBe(0)
    writeFileSync(join(repo, 'new.txt'), 'x')
    expect((await worktreeStatus(repo)).dirty).toBe(1)
    writeFileSync(join(repo, 'README.md'), '# changed\n')
    expect((await worktreeStatus(repo)).dirty).toBe(2)
  })

  it('worktreeStatus returns ahead/behind 0 with no upstream', async () => {
    const s = await worktreeStatus(repo)
    expect(s.ahead).toBe(0)
    expect(s.behind).toBe(0)
  })

  it('worktreeDiff reports a modified tracked file with the new line and path', async () => {
    writeFileSync(join(repo, 'README.md'), '# changed line\n')
    const diff = await worktreeDiff(repo)
    expect(diff).toContain('README.md')
    expect(diff).toMatch(/^\+# changed line$/m)
    expect(diff).toMatch(/^-# temp$/m)
  })

  it('worktreeDiff keeps non-ASCII filenames literal (core.quotepath=false)', async () => {
    writeFileSync(join(repo, '中文.txt'), 'hello\n')
    git(['add', '.'])
    git(['commit', '-q', '-m', 'add cjk'])
    writeFileSync(join(repo, '中文.txt'), 'world\n')
    const diff = await worktreeDiff(repo)
    expect(diff).toContain('中文.txt')
    expect(diff).not.toContain('\\344') // not octal-escaped
  })

  it('worktreeDiff is empty for a clean worktree', async () => {
    expect((await worktreeDiff(repo)).trim()).toBe('')
  })

  it('removeWorktree makes it disappear from the list', async () => {
    const wtPath = join(repo, '..', `wt-rm-${Date.now()}`)
    await createWorktree(repo, { path: wtPath, branch: 'to-remove', newBranch: true })
    expect((await listWorktrees(repo)).some((w) => w.branch === 'to-remove')).toBe(true)

    await removeWorktree(repo, wtPath, { force: true })
    expect((await listWorktrees(repo)).some((w) => w.branch === 'to-remove')).toBe(false)
  })

  it('expandWorktreeTemplate fills {repo}/{branch} and a filesystem-safe {timestamp}', () => {
    const now = new Date(2026, 5, 10, 14, 5, 2) // 2026-06-10 14:05:02 (local)
    const out = expandWorktreeTemplate('../{repo}-wt-{branch}-{timestamp}', {
      repo: 'r',
      branch: 'b',
      now
    })
    expect(out.startsWith('../r-wt-b-')).toBe(true)
    const ts = out.slice('../r-wt-b-'.length)
    expect(ts).toMatch(/^\d{8}-\d{6}$/)
    expect(ts).not.toMatch(/[/: ]/)
  })

  it('expandWorktreeTemplate sanitizes the branch and leaves no placeholders behind', () => {
    const out = expandWorktreeTemplate('{repo}/{branch}', {
      repo: 'myrepo',
      branch: 'feat/new thing',
      now: new Date(2026, 0, 1, 0, 0, 0)
    })
    expect(out).toBe('myrepo/feat_new_thing')
  })

  it('removeWorktree keeps the branch by default but deletes it when asked', async () => {
    const branches = (): string => git(['branch', '--list'])
    // kept by default
    const p1 = join(repo, '..', `wt-keep-${Date.now()}`)
    await createWorktree(repo, { path: p1, branch: 'keep-branch', newBranch: true })
    await removeWorktree(repo, p1, { force: true })
    expect(branches()).toContain('keep-branch')

    // deleted when requested
    const p2 = join(repo, '..', `wt-del-${Date.now()}`)
    await createWorktree(repo, { path: p2, branch: 'del-branch', newBranch: true })
    await removeWorktree(repo, p2, { force: true, deleteBranch: 'del-branch' })
    expect(branches()).not.toContain('del-branch')
  })
})
