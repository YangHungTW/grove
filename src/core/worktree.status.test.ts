// Read-only queries: status, branch/repo predicates, template expansion.
// (Split from the original worktree.test.ts — vitest runs tests within one file
// serially but files in parallel, so the git-heavy suite is spread by topic.)
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createWorktree,
  listWorktrees,
  isGitRepo,
  worktreeStatus,
  expandWorktreeTemplate,
  defaultBranch,
  isLinkedWorktree,
  branchExists
} from './worktree'
import { gitIn, useTempRepo } from './worktree.fixture'

let repo: string
useTempRepo((r) => (repo = r))
const git = (args: string[]): string => gitIn(repo, args)

describe('worktree git operations (status + queries)', () => {
  it('branchExists reflects whether a local branch is present', async () => {
    expect(await branchExists(repo, 'main')).toBe(true)
    expect(await branchExists(repo, 'nope')).toBe(false)
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

  it('worktreeStatus counts every file inside an untracked directory (matches the diff pane)', async () => {
    mkdirSync(join(repo, 'newdir', 'nested'), { recursive: true })
    writeFileSync(join(repo, 'newdir', 'a.txt'), 'a')
    writeFileSync(join(repo, 'newdir', 'b.txt'), 'b')
    writeFileSync(join(repo, 'newdir', 'nested', 'c.txt'), 'c')
    expect((await worktreeStatus(repo)).dirty).toBe(3)
  })

  it('worktreeStatus returns ahead/behind 0 with no upstream', async () => {
    const s = await worktreeStatus(repo)
    expect(s.ahead).toBe(0)
    expect(s.behind).toBe(0)
  })

  it('worktreeStatus reports the current branch, tracking a checkout, empty when detached', async () => {
    expect((await worktreeStatus(repo)).branch).toBe('main')
    git(['checkout', '-q', '-b', 'feature/login'])
    expect((await worktreeStatus(repo)).branch).toBe('feature/login')
    git(['checkout', '-q', '--detach'])
    expect((await worktreeStatus(repo)).branch).toBe('')
  })

  it('isLinkedWorktree is false for the primary checkout, true for a linked one', async () => {
    expect(await isLinkedWorktree(repo)).toBe(false)
    const wtPath = join(repo, '..', `wt-linked-${Date.now()}`)
    await createWorktree(repo, { path: wtPath, branch: 'feat-linked', newBranch: true })
    try {
      expect(await isLinkedWorktree(wtPath)).toBe(true)
    } finally {
      rmSync(wtPath, { recursive: true, force: true })
    }
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

  it('defaultBranch falls back to an existing local main when origin/HEAD is unset', async () => {
    expect(await defaultBranch(repo)).toBe('main')
  })
})
