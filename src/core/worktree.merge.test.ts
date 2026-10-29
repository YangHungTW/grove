// commitAll + mergeIntoDefault (the "finish" flow). (Split from
// worktree.test.ts; see worktree.status.test.ts for why.)
import { describe, it, expect } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createWorktree, worktreeStatus, commitAll, mergeIntoDefault } from './worktree'
import { gitIn, useTempRepo } from './worktree.fixture'

let repo: string
useTempRepo((r) => (repo = r))
const git = (args: string[]): string => gitIn(repo, args)

describe('worktree git operations (commit + merge)', () => {
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
})
