import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  isGitRepo,
  worktreeStatus,
  expandWorktreeTemplate,
  worktreeDiff,
  defaultBranch,
  commitAll,
  mergeIntoDefault,
  isLinkedWorktree
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

  it('worktreeDiff includes untracked files (diffed against /dev/null)', async () => {
    // The card's dirty count includes untracked files — the diff pane must too.
    writeFileSync(join(repo, 'brand-new.txt'), 'first line\n')
    const diff = await worktreeDiff(repo)
    expect(diff).toContain('brand-new.txt')
    expect(diff).toMatch(/^\+first line$/m)
    expect(diff).toContain('new file mode')
  })

  it('worktreeDiff respects .gitignore for untracked files', async () => {
    writeFileSync(join(repo, '.gitignore'), 'ignored.log\n')
    git(['add', '.gitignore'])
    git(['commit', '-q', '-m', 'ignore logs'])
    writeFileSync(join(repo, 'ignored.log'), 'noise\n')
    expect(await worktreeDiff(repo)).not.toContain('ignored.log')
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

  it('worktreeDiff on the PRIMARY checkout shows only uncommitted work, even on a non-default branch', async () => {
    // Reproduces: primary checkout on `develop`, far ahead of `main` — the diff
    // pane must NOT dump the whole develop-vs-main history (196-file syndrome).
    git(['checkout', '-q', '-b', 'develop'])
    writeFileSync(join(repo, 'committed-on-develop.txt'), 'lots of history\n')
    await commitAll(repo, 'develop work')
    writeFileSync(join(repo, 'README.md'), '# uncommitted edit\n')

    const diff = await worktreeDiff(repo)
    expect(diff).toContain('README.md')
    expect(diff).not.toContain('committed-on-develop.txt')
  })

  it('worktreeDiff on a LINKED worktree still includes committed + uncommitted work', async () => {
    const wtPath = join(repo, '..', `wt-diff-${Date.now()}`)
    await createWorktree(repo, { path: wtPath, branch: 'feat-diff', newBranch: true })
    try {
      writeFileSync(join(wtPath, 'committed.txt'), 'committed\n')
      await commitAll(wtPath, 'committed change')
      writeFileSync(join(wtPath, 'README.md'), '# uncommitted\n')

      const diff = await worktreeDiff(wtPath)
      expect(diff).toContain('committed.txt')
      expect(diff).toContain('README.md')
    } finally {
      rmSync(wtPath, { recursive: true, force: true })
    }
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

  it('defaultBranch falls back to an existing local main when origin/HEAD is unset', async () => {
    expect(await defaultBranch(repo)).toBe('main')
  })

  it('commitAll stages and commits everything (and throws on a clean tree)', async () => {
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    writeFileSync(join(repo, 'README.md'), '# edited\n')
    await commitAll(repo, 'finish: a + readme')
    expect((await worktreeStatus(repo)).dirty).toBe(0)
    expect(git(['log', '-1', '--format=%s'])).toContain('finish: a + readme')
    await expect(commitAll(repo, 'nothing')).rejects.toThrow()
  })

  it('mergeIntoDefault merges a worktree branch into main', async () => {
    const wtPath = join(repo, '..', `wt-merge-${Date.now()}`)
    await createWorktree(repo, { path: wtPath, branch: 'feat-m', newBranch: true })
    try {
      writeFileSync(join(wtPath, 'feature.txt'), 'feature\n')
      await commitAll(wtPath, 'add feature')
      const target = await mergeIntoDefault(repo, 'feat-m')
      expect(target).toBe('main')
      expect(git(['log', '-1', '--format=%s', 'main'])).toContain('add feature')
    } finally {
      rmSync(wtPath, { recursive: true, force: true })
    }
  })

  it('mergeIntoDefault refuses when the primary worktree is dirty', async () => {
    const wtPath = join(repo, '..', `wt-dirty-${Date.now()}`)
    await createWorktree(repo, { path: wtPath, branch: 'feat-d', newBranch: true })
    try {
      writeFileSync(join(wtPath, 'feature.txt'), 'feature\n')
      await commitAll(wtPath, 'add feature')
      writeFileSync(join(repo, 'README.md'), '# dirty main\n')
      await expect(mergeIntoDefault(repo, 'feat-d')).rejects.toThrow(/uncommitted/)
    } finally {
      rmSync(wtPath, { recursive: true, force: true })
    }
  })

  it('mergeIntoDefault aborts a conflicting merge and leaves main clean', async () => {
    const wtPath = join(repo, '..', `wt-conf-${Date.now()}`)
    await createWorktree(repo, { path: wtPath, branch: 'feat-c', newBranch: true })
    try {
      writeFileSync(join(wtPath, 'README.md'), '# branch version\n')
      await commitAll(wtPath, 'branch readme')
      writeFileSync(join(repo, 'README.md'), '# main version\n')
      await commitAll(repo, 'main readme')
      await expect(mergeIntoDefault(repo, 'feat-c')).rejects.toThrow(/aborted/)
      // the abort left no in-progress merge state behind
      expect((await worktreeStatus(repo)).dirty).toBe(0)
    } finally {
      rmSync(wtPath, { recursive: true, force: true })
    }
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
