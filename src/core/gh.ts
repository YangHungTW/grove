/**
 * GitHub CLI (`gh`) integration for PR creation/status (Electron-free).
 * `gh` lives on the user's shell PATH, which a GUI app doesn't inherit, so its
 * location — and the GH_… / GITHUB_… variables a profile may export for it —
 * are captured through a login shell once; PR creation (rare, user-initiated)
 * still runs through one so it sees the full shell env.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** The one process-spawning primitive here, injectable so the cache logic can
 * be tested without gh or git on the machine. Resolves stdout; rejects on a
 * non-zero exit like execFile does. `env` replaces the child's environment
 * when given (execFile semantics), otherwise the child inherits ours. */
export type Runner = (
  file: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
) => Promise<string>
const defaultRunner: Runner = async (file, args, cwd, env) =>
  (await execFileAsync(file, args, { cwd, env })).stdout

export interface PrStatusDeps {
  run: Runner
  now: () => number
}
const defaultDeps: PrStatusDeps = { run: defaultRunner, now: Date.now }

export type CheckSummary = 'pass' | 'fail' | 'pending' | 'none'

export interface PrInfo {
  number: number
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  checks: CheckSummary
  reviewDecision: string
}

/** One entry of gh's statusCheckRollup: a CheckRun or a StatusContext. */
interface RollupItem {
  __typename?: string
  status?: string
  conclusion?: string
  state?: string
}

/** Collapse a PR's check rollup into one badge-worthy state. */
export function summarizeChecks(rollup: RollupItem[] | null | undefined): CheckSummary {
  if (!rollup || rollup.length === 0) return 'none'
  let pending = false
  for (const item of rollup) {
    // CheckRun reports status/conclusion; StatusContext reports state.
    const outcome = item.state ?? (item.status !== 'COMPLETED' ? 'PENDING' : item.conclusion)
    if (outcome === 'PENDING' || outcome === 'EXPECTED') pending = true
    else if (outcome !== 'SUCCESS' && outcome !== 'NEUTRAL' && outcome !== 'SKIPPED') return 'fail'
  }
  return pending ? 'pending' : 'pass'
}

/** Shape `gh pr view --json …` output into a {@link PrInfo}. */
export function parsePrView(json: unknown): PrInfo | null {
  if (!json || typeof json !== 'object') return null
  const o = json as {
    number?: number
    url?: string
    state?: string
    reviewDecision?: string
    statusCheckRollup?: RollupItem[]
  }
  if (typeof o.number !== 'number' || !o.url) return null
  return {
    number: o.number,
    url: o.url,
    state: (o.state as PrInfo['state']) ?? 'OPEN',
    checks: summarizeChecks(o.statusCheckRollup),
    reviewDecision: o.reviewDecision ?? ''
  }
}

function loginShell(): string {
  return process.env.SHELL || '/bin/zsh'
}

/** What the login shell knows about gh that a GUI process doesn't: where the
 * binary is, and the variables gh reads from the environment (a profile may
 * export GH_TOKEN / GITHUB_TOKEN / GH_HOST / GH_ENTERPRISE_TOKEN / GH_CONFIG_DIR
 * instead of using `gh auth login`). Captured together, once. */
interface GhResolved {
  path: string
  env: Record<string, string>
}

/** Pick the gh path and the GH_… / GITHUB_… variables out of the output of
 * `command -v gh && env`. Tolerant of profile noise around them: the path is
 * the first absolute path ending in `/gh`, and only lines shaped like one of
 * the wanted variables count (a multi-line value's continuation lines don't
 * match and are ignored). Exported for the tests. */
export function parseGhResolve(out: string): GhResolved | null {
  let path = ''
  const env: Record<string, string> = {}
  for (const line of out.split('\n')) {
    if (!path && /^\/\S*\/gh$/.test(line.trim())) {
      path = line.trim()
      continue
    }
    const m = /^((?:GH|GITHUB)_[A-Z0-9_]*)=(.*)$/.exec(line)
    if (m) env[m[1]] = m[2]
  }
  return path ? { path, env } : null
}

// Resolved ONCE through a login shell. Every poll used to pay for a fresh login
// shell (zprofile + PATH setup) just to find the binary; now only the first
// does, and the polls are plain execFiles of the absolute path with the
// captured variables layered over our own env. A failed lookup is not cached —
// the next poll tries again.
let ghResolvePromise: Promise<GhResolved | null> | null = null
function resolveGh(run: Runner): Promise<GhResolved | null> {
  if (!ghResolvePromise) {
    ghResolvePromise = run(loginShell(), ['-lc', 'command -v gh && env'], process.cwd())
      .then(parseGhResolve)
      .catch(() => null)
      .then((r) => {
        if (!r) ghResolvePromise = null
        return r
      })
  }
  return ghResolvePromise
}

/** How long a PR answer stays good when HEAD hasn't moved. Checks and reviews
 * can change without a local commit, so the entry still ages out — the badge
 * is at most this stale on CI going green. The expensive part of a poll was
 * the login shell, now gone; the API call itself is cheap enough for this. */
export const PR_CACHE_TTL_MS = 2 * 60_000
const prCache = new Map<string, { head: string; at: number; info: PrInfo | null }>()

/** Forget cached answers (all, or one worktree's). Tests reset between cases;
 * prCreate drops its worktree so the new PR shows up on the next poll. */
export function resetPrCache(path?: string): void {
  if (path === undefined) {
    prCache.clear()
    ghResolvePromise = null
  } else prCache.delete(path)
}

/** PR for the branch checked out at `path`, or null (no PR / no gh / error).
 *
 * Polled for every non-primary worktree every minute, so the answer is cached
 * by (path, HEAD sha): a cheap `git rev-parse HEAD` decides whether the cached
 * entry still describes this checkout, and gh — a login shell + a GitHub API
 * round trip — is only asked again when HEAD moved or the entry aged out. */
export async function prStatus(path: string, deps: PrStatusDeps = defaultDeps): Promise<PrInfo | null> {
  const head = await deps.run('git', ['rev-parse', 'HEAD'], path).then((s) => s.trim(), () => '')
  const hit = prCache.get(path)
  if (hit && hit.head === head && deps.now() - hit.at < PR_CACHE_TTL_MS) return hit.info
  const info = await queryPr(path, deps.run)
  prCache.set(path, { head, at: deps.now(), info })
  return info
}

async function queryPr(path: string, run: Runner): Promise<PrInfo | null> {
  try {
    const gh = await resolveGh(run)
    if (!gh) return null
    const stdout = await run(
      gh.path,
      ['pr', 'view', '--json', 'number,url,state,reviewDecision,statusCheckRollup'],
      path,
      { ...process.env, ...gh.env }
    )
    return parsePrView(JSON.parse(stdout))
  } catch {
    return null
  }
}

/** `gh pr create --fill` for the branch at `path`; returns the PR URL. */
export async function prCreate(path: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(loginShell(), ['-lc', 'gh pr create --fill'], {
      cwd: path
    })
    // The cached "no PR" for this worktree is now wrong; let the next poll ask.
    resetPrCache(path)
    const m = /https:\/\/\S+/.exec(stdout)
    return m?.[0] ?? stdout.trim()
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    throw new Error((e.stderr || e.message || String(err)).trim())
  }
}
