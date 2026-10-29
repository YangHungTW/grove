// createWorktree / removeWorktree lifecycle. (Split from worktree.test.ts; see
// worktree.status.test.ts for why.)
import { describe, it, expect } from 'vitest'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { createWorktree, listWorktrees, removeWorktree, BranchExistsError } from './worktree'
import { gitIn, useTempRepo } from './worktree.fixture'

let repo: string
useTempRepo((r) => (repo = r))
const git = (args: string[]): string => gitIn(repo, args)

describe('worktree git operations (create + remove)', () => {
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

  it('createWorktree with newBranch throws BranchExistsError on a name collision', async () => {
    git(['branch', 'dup'])
    const wtPath = join(repo, '..', `wt-dup-${Date.now()}`)
    await expect(
      createWorktree(repo, { path: wtPath, branch: 'dup', newBranch: true })
    ).rejects.toBeInstanceOf(BranchExistsError)
    // The collision is detected up front — no partial worktree is left behind.
    const list = await listWorktrees(repo)
    expect(list.find((w) => w.branch === 'dup')).toBeUndefined()
  })

  it('createWorktree with newBranch:false checks out the existing branch (the use-existing path)', async () => {
    git(['branch', 'existing'])
    const wtPath = join(repo, '..', `wt-existing-${Date.now()}`)
    const info = await createWorktree(repo, { path: wtPath, branch: 'existing', newBranch: false })
    expect(info.branch).toBe('existing')
    const list = await listWorktrees(repo)
    expect(list.find((w) => w.branch === 'existing')).toBeDefined()
    rmSync(wtPath, { recursive: true, force: true })
  })

  it('removeWorktree makes it disappear from the list', async () => {
    const wtPath = join(repo, '..', `wt-rm-${Date.now()}`)
    await createWorktree(repo, { path: wtPath, branch: 'to-remove', newBranch: true })
    expect((await listWorktrees(repo)).some((w) => w.branch === 'to-remove')).toBe(true)

    await removeWorktree(repo, wtPath, { force: true })
    expect((await listWorktrees(repo)).some((w) => w.branch === 'to-remove')).toBe(false)
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
