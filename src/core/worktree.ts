import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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

// Async on purpose: these run in the Electron MAIN process. A synchronous
// execFileSync would block the event loop (and therefore all pty I/O + IPC for
// every window) for the whole duration of the git call — a large `git diff`
// would visibly freeze every open terminal. execFile keeps the loop free.
async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  return stdout as string
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
  /** Current branch short name; '' when detached (lets the card track an
   * in-terminal `git checkout` / branch rename without a full reload). */
  branch: string
}

/** Working-tree status: branch, dirty file count, and ahead/behind vs upstream.
 * The three git queries are independent, so they run concurrently (a git spawn
 * dominates the cost) and each fails soft — a missing answer (e.g. no upstream)
 * never sinks the others. */
export async function worktreeStatus(path: string): Promise<WorktreeStatus> {
  const [branch, dirty, [behind, ahead]] = await Promise.all([
    // Empty for a detached HEAD — the card falls back to '(detached)'.
    git(path, ['branch', '--show-current'])
      .then((s) => s.trim())
      .catch(() => ''),
    // -uall counts each untracked FILE (porcelain otherwise collapses a whole
    // untracked directory into one entry), so the card's dirty count matches
    // the file count in the diff/review pane.
    git(path, ['status', '--porcelain', '-uall'])
      .then((p) => p.split('\n').filter((l) => l.trim().length > 0).length)
      .catch(() => 0),
    // left-right counts vs upstream; rejects (→ [0, 0]) when no upstream is set.
    git(path, ['rev-list', '--count', '--left-right', '@{upstream}...HEAD'])
      .then((lr) => lr.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0) as [number, number])
      .catch(() => [0, 0] as [number, number])
  ])
  return { dirty, ahead, behind, branch }
}

/** True if `path` is inside a git working tree (used to validate opened folders). */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    return (await git(path, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch {
    return false
  }
}

/** True when a local branch of this name already exists. */
export async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await git(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

/**
 * Thrown by {@link createWorktree} when a NEW branch was requested but one of
 * that name already exists. The `BRANCH_EXISTS` sentinel survives Electron IPC
 * (which flattens errors to their message), so the renderer can offer to open
 * the existing branch instead of showing a raw git fatal.
 */
export class BranchExistsError extends Error {
  readonly code = 'BRANCH_EXISTS'
  constructor(readonly branch: string) {
    super(`BRANCH_EXISTS: a branch named "${branch}" already exists`)
    this.name = 'BranchExistsError'
  }
}

/** `git worktree add` — returns the resulting worktree's parsed info. */
export async function createWorktree(
  repoRoot: string,
  opts: CreateWorktreeOptions
): Promise<WorktreeInfo> {
  const path = opts.path
  if (!path) throw new Error('createWorktree: path is required')
  const args = ['worktree', 'add']
  if (opts.newBranch) {
    // Pre-flight so a collision is a typed, actionable error (use existing /
    // rename) instead of git's bare `fatal: a branch named 'X' already exists`.
    if (await branchExists(repoRoot, opts.branch)) throw new BranchExistsError(opts.branch)
    args.push('-b', opts.branch, path)
    if (opts.base) args.push(opts.base)
  } else {
    args.push(path, opts.branch)
  }
  await git(repoRoot, args)

  const list = await listWorktrees(repoRoot)
  const match = list.find((w) => w.branch === opts.branch)
  if (match) return match
  // Fallback: synthesize from inputs if parsing missed it.
  return { path, branch: opts.branch }
}

/** `git worktree list --porcelain` parsed into structured records. */
export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  const out = await git(repoRoot, ['worktree', 'list', '--porcelain'])
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

/** True when `path` is a linked worktree (`git worktree add`), false for the
 * repo's primary checkout. A linked worktree's git dir always lives at the
 * main repo's `.git/worktrees/<name>` — a path-shape check, deliberately not a
 * string comparison against --git-common-dir (symlinked tmp dirs on macOS make
 * the two render differently for the same location). */
export async function isLinkedWorktree(path: string): Promise<boolean> {
  try {
    const gitDir = (await git(path, ['rev-parse', '--absolute-git-dir'])).trim()
    return /\.git[/\\]worktrees[/\\][^/\\]+$/.test(gitDir)
  } catch {
    return false
  }
}

const diffArgs = (range: string[]): string[] => ['-c', 'core.quotepath=false', 'diff', ...range]

// Hard cap on per-file `--no-index` spawns for untracked files — an agent that
// generated thousands of files shouldn't fork thousands of git processes.
const UNTRACKED_DIFF_CAP = 200

/** Unified diff of untracked files (each against /dev/null), so brand-new
 * files show up in the review pane. Respects .gitignore. */
async function untrackedDiff(path: string): Promise<string> {
  let names: string[] = []
  try {
    names = (await git(path, ['ls-files', '--others', '--exclude-standard']))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return ''
  }
  const parts: string[] = []
  for (const name of names.slice(0, UNTRACKED_DIFF_CAP)) {
    try {
      // `--no-index` exits 1 when the files differ — the expected outcome, so
      // the diff body arrives on the error's stdout.
      parts.push(await git(path, diffArgs(['--no-index', '--', '/dev/null', name])))
    } catch (err) {
      const out = (err as { stdout?: string }).stdout
      if (out) parts.push(out)
    }
  }
  return parts.join('')
}

/**
 * The set of changes a worktree introduced, as a unified diff.
 *
 * For a LINKED worktree (a feature branch) it combines:
 *  - committed work: `git diff <base>..HEAD`, where `base` is the merge-base
 *    with the repo's default branch (origin/HEAD, else `main`/`master`);
 *  - uncommitted work: `git diff HEAD` (staged + unstaged vs HEAD);
 *  - untracked files, each diffed against /dev/null.
 *
 * The PRIMARY checkout is the repo's long-lived branch, not a feature branch
 * under review — diffing it against the default branch would dump the whole
 * branch history (e.g. develop vs main), so only uncommitted + untracked work
 * is shown (matching the card's dirty count).
 *
 * An explicit `baseRef` overrides the computed base (and the primary-checkout
 * shortcut). `core.quotepath=false` keeps non-ASCII (e.g. CJK) filenames
 * literal instead of octal-escaped.
 */
export async function worktreeDiff(path: string, baseRef?: string): Promise<string> {
  let base = baseRef
  if (!base && !(await isLinkedWorktree(path))) {
    let tracked = ''
    try {
      tracked = await git(path, diffArgs(['HEAD']))
    } catch {
      /* no HEAD / not a repo */
    }
    const untracked = await untrackedDiff(path)
    return [tracked, untracked].filter((s) => s.trim().length > 0).join('\n')
  }
  if (!base) {
    for (const ref of ['origin/HEAD', 'main', 'master']) {
      try {
        base = (await git(path, ['merge-base', 'HEAD', ref])).trim()
        if (base) break
      } catch {
        /* try the next candidate */
      }
    }
  }
  let head = ''
  try {
    head = (await git(path, ['rev-parse', 'HEAD'])).trim()
  } catch {
    /* no HEAD */
  }
  let committed = ''
  if (base && base !== head) {
    try {
      committed = await git(path, diffArgs([`${base}..HEAD`]))
    } catch {
      /* base unreachable */
    }
  }
  let uncommitted = ''
  try {
    uncommitted = await git(path, diffArgs(['HEAD']))
  } catch {
    /* not a repo */
  }
  const untracked = await untrackedDiff(path)
  return [committed, uncommitted, untracked].filter((s) => s.trim().length > 0).join('\n')
}

/** The repo's default branch: origin/HEAD if set, else an existing local
 * `main`/`master`, else whatever the primary worktree has checked out. */
export async function defaultBranch(repoRoot: string): Promise<string> {
  try {
    const ref = (await git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
    if (ref) return ref.replace(/^origin\//, '')
  } catch {
    /* no origin/HEAD configured */
  }
  for (const b of ['main', 'master']) {
    try {
      await git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])
      return b
    } catch {
      /* try the next candidate */
    }
  }
  return (await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

/** Stage everything and commit. Throws if there is nothing to commit. */
export async function commitAll(path: string, message: string): Promise<void> {
  await git(path, ['add', '-A'])
  await git(path, ['commit', '-m', message])
}

/**
 * Merge `branch` into the repo's default branch, run from the PRIMARY worktree.
 * Refuses (rather than half-merging) when the primary worktree is on a
 * different branch or has uncommitted changes; a conflicted merge is aborted so
 * the primary worktree is never left mid-merge. Returns the target branch name.
 */
export async function mergeIntoDefault(repoRoot: string, branch: string): Promise<string> {
  const target = await defaultBranch(repoRoot)
  const current = (await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (current !== target)
    throw new Error(`primary worktree is on '${current}', not '${target}' — switch it first`)
  // Untracked files don't block a merge — only tracked modifications do.
  const porcelain = await git(repoRoot, ['status', '--porcelain', '--untracked-files=no'])
  if (porcelain.trim().length > 0)
    throw new Error(`'${target}' has uncommitted changes — commit or stash them first`)
  try {
    await git(repoRoot, ['merge', '--no-edit', branch])
  } catch (err) {
    await git(repoRoot, ['merge', '--abort']).catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`merge of '${branch}' failed and was aborted:\n${msg}`)
  }
  return target
}

/** Push the worktree's branch, creating/updating its upstream on origin. */
export async function pushBranch(path: string): Promise<void> {
  await git(path, ['push', '-u', 'origin', 'HEAD'])
}

/** `git worktree remove` (with `--force` when requested). */
export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  opts: { force?: boolean; deleteBranch?: string } = {}
): Promise<void> {
  const args = ['worktree', 'remove']
  if (opts.force) args.push('--force')
  args.push(worktreePath)
  await git(repoRoot, args)
  // `git worktree remove` keeps the branch; delete it only when asked.
  if (opts.deleteBranch) await git(repoRoot, ['branch', '-D', opts.deleteBranch])
}
