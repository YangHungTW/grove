import { execFileSync } from 'node:child_process'

export interface WorktreeInfo {
  path: string
  /** Branch short name (refs/heads/ stripped), or '' when detached/bare. */
  branch: string
  head?: string
  bare?: boolean
  detached?: boolean
}

export interface CreateWorktreeOptions {
  path: string
  branch: string
  /** Ref to branch from (defaults to current HEAD). */
  base?: string
  /** Create a new branch (`-b`). If false, check out an existing branch. */
  newBranch?: boolean
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
}

/** True if `path` is inside a git working tree (used to validate opened folders). */
export function isGitRepo(path: string): boolean {
  try {
    return git(path, ['rev-parse', '--is-inside-work-tree']).trim() === 'true'
  } catch {
    return false
  }
}

/** `git worktree add` — returns the resulting worktree's parsed info. */
export function createWorktree(repoRoot: string, opts: CreateWorktreeOptions): WorktreeInfo {
  const args = ['worktree', 'add']
  if (opts.newBranch) {
    args.push('-b', opts.branch, opts.path)
    if (opts.base) args.push(opts.base)
  } else {
    args.push(opts.path, opts.branch)
  }
  git(repoRoot, args)

  const list = listWorktrees(repoRoot)
  const match = list.find((w) => w.branch === opts.branch)
  if (match) return match
  // Fallback: synthesize from inputs if parsing missed it.
  return { path: opts.path, branch: opts.branch }
}

/** `git worktree list --porcelain` parsed into structured records. */
export function listWorktrees(repoRoot: string): WorktreeInfo[] {
  const out = git(repoRoot, ['worktree', 'list', '--porcelain'])
  const records: WorktreeInfo[] = []
  let current: Partial<WorktreeInfo> | null = null

  const flush = (): void => {
    if (current && current.path) {
      records.push({
        path: current.path,
        branch: current.branch ?? '',
        head: current.head,
        bare: current.bare,
        detached: current.detached
      })
    }
    current = null
  }

  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      current = { path: line.slice('worktree '.length).trim() }
    } else if (!current) {
      continue
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim()
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    } else if (line === 'bare') {
      current.bare = true
    } else if (line === 'detached') {
      current.detached = true
    }
  }
  flush()
  return records
}

/** `git worktree remove` (with `--force` when requested). */
export function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  opts: { force?: boolean } = {}
): void {
  const args = ['worktree', 'remove']
  if (opts.force) args.push('--force')
  args.push(worktreePath)
  git(repoRoot, args)
}
