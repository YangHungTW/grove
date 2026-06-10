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
  /** Target path. Optional over IPC — the main process fills it from settings. */
  path?: string
  branch: string
  /** Ref to branch from (defaults to current HEAD). */
  base?: string
  /** Create a new branch (`-b`). If false, check out an existing branch. */
  newBranch?: boolean
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Filesystem-safe local datetime: `YYYYMMDD-HHMMSS` (no `/`, `:`, or spaces). */
function formatTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

/**
 * Expand a worktree folder template. Supported placeholders:
 * `{repo}`, `{branch}` (sanitized to `[\w.-]`), and `{timestamp}`
 * (the `now` Date formatted as `YYYYMMDD-HHMMSS`). Pure — the caller
 * supplies `now` so resolution is deterministic and testable.
 */
export function expandWorktreeTemplate(
  tmpl: string,
  vars: { repo: string; branch: string; now: Date }
): string {
  const safeBranch = vars.branch.replace(/[^\w.-]/g, '_')
  return tmpl
    .replace(/\{repo\}/g, vars.repo)
    .replace(/\{branch\}/g, safeBranch)
    .replace(/\{timestamp\}/g, formatTimestamp(vars.now))
}

export interface WorktreeStatus {
  /** Number of changed (porcelain) entries. */
  dirty: number
  ahead: number
  behind: number
}

/** Working-tree status: dirty file count and ahead/behind vs upstream (0 if none). */
export function worktreeStatus(path: string): WorktreeStatus {
  let dirty = 0
  let ahead = 0
  let behind = 0
  try {
    const porcelain = git(path, ['status', '--porcelain'])
    dirty = porcelain.split('\n').filter((l) => l.trim().length > 0).length
  } catch {
    /* not a repo */
  }
  try {
    // left-right counts vs upstream; throws if no upstream configured.
    const lr = git(path, ['rev-list', '--count', '--left-right', '@{upstream}...HEAD']).trim()
    const [b, a] = lr.split(/\s+/).map((n) => parseInt(n, 10) || 0)
    behind = b
    ahead = a
  } catch {
    /* no upstream */
  }
  return { dirty, ahead, behind }
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
  const path = opts.path
  if (!path) throw new Error('createWorktree: path is required')
  const args = ['worktree', 'add']
  if (opts.newBranch) {
    args.push('-b', opts.branch, path)
    if (opts.base) args.push(opts.base)
  } else {
    args.push(path, opts.branch)
  }
  git(repoRoot, args)

  const list = listWorktrees(repoRoot)
  const match = list.find((w) => w.branch === opts.branch)
  if (match) return match
  // Fallback: synthesize from inputs if parsing missed it.
  return { path, branch: opts.branch }
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

/**
 * The set of changes a worktree introduced, as a unified diff. Combines:
 *  - committed work: `git diff <base>..HEAD`, where `base` is the merge-base
 *    with the repo's default branch (origin/HEAD, else `main`/`master`);
 *  - uncommitted work: `git diff HEAD` (staged + unstaged vs HEAD).
 * An explicit `baseRef` overrides the computed base. Untracked files are not
 * included (they have no diff against the index).
 */
export function worktreeDiff(path: string, baseRef?: string): string {
  let base = baseRef
  if (!base) {
    for (const ref of ['origin/HEAD', 'main', 'master']) {
      try {
        base = git(path, ['merge-base', 'HEAD', ref]).trim()
        if (base) break
      } catch {
        /* try the next candidate */
      }
    }
  }
  const head = (() => {
    try {
      return git(path, ['rev-parse', 'HEAD']).trim()
    } catch {
      return ''
    }
  })()
  let committed = ''
  if (base && base !== head) {
    try {
      committed = git(path, ['diff', `${base}..HEAD`])
    } catch {
      /* base unreachable */
    }
  }
  let uncommitted = ''
  try {
    uncommitted = git(path, ['diff', 'HEAD'])
  } catch {
    /* not a repo */
  }
  return [committed, uncommitted].filter((s) => s.trim().length > 0).join('\n')
}

/** `git worktree remove` (with `--force` when requested). */
export function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  opts: { force?: boolean; deleteBranch?: string } = {}
): void {
  const args = ['worktree', 'remove']
  if (opts.force) args.push('--force')
  args.push(worktreePath)
  git(repoRoot, args)
  // `git worktree remove` keeps the branch; delete it only when asked.
  if (opts.deleteBranch) git(repoRoot, ['branch', '-D', opts.deleteBranch])
}
