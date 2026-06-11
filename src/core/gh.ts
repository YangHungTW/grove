/**
 * GitHub CLI (`gh`) integration for PR creation/status (Electron-free).
 * `gh` is run through a login shell so it resolves on PATH the same way agent
 * commands do (GUI apps don't inherit the user's shell PATH).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

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

/** PR for the branch checked out at `path`, or null (no PR / no gh / error). */
export async function prStatus(path: string): Promise<PrInfo | null> {
  try {
    const { stdout } = await run(
      loginShell(),
      ['-lc', 'gh pr view --json number,url,state,reviewDecision,statusCheckRollup'],
      { cwd: path }
    )
    return parsePrView(JSON.parse(stdout))
  } catch {
    return null
  }
}

/** `gh pr create --fill` for the branch at `path`; returns the PR URL. */
export async function prCreate(path: string): Promise<string> {
  try {
    const { stdout } = await run(loginShell(), ['-lc', 'gh pr create --fill'], { cwd: path })
    const m = /https:\/\/\S+/.exec(stdout)
    return m?.[0] ?? stdout.trim()
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    throw new Error((e.stderr || e.message || String(err)).trim())
  }
}
