// worktreeDiff: what the review pane shows. (Split from worktree.test.ts; see
// worktree.status.test.ts for why.)
import { describe, it, expect } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createWorktree, worktreeDiff, commitAll } from './worktree'
import { gitIn, useTempRepo } from './worktree.fixture'

let repo: string
useTempRepo((r) => (repo = r))
const git = (args: string[]): string => gitIn(repo, args)

describe('worktree git operations (diff)', () => {
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
})
