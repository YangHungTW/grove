/**
 * Pure helpers for acting on fleet sessions — Claude sessions running on this
 * machine that are not (yet) Grove panes. Electron-free so the two risky
 * decisions are unit-testable:
 *
 *  - The attach command embeds a job id read from ANOTHER program's state file
 *    into a `$SHELL -ilc` string, so the id must be validated, quoted, or both.
 *  - Which worktree an attached pane lands in decides where the user sees it;
 *    a wrong prefix match would file someone's session under an unrelated card.
 */
import { shellQuote } from './shellQuote'

/** Job ids as `claude agents --json` reports them: short hex-ish tokens. The
 * registry file is another program's writable state, so treat the value as
 * untrusted input rather than assuming the shape holds. */
const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * The command an attach pane runs, or null for a malformed job id. Quoted even
 * though the pattern already forbids shell metacharacters — defense in depth,
 * matching how every other interpolated value here is handled.
 */
export function buildAttachCommand(jobId: string): string | null {
  if (!JOB_ID.test(jobId)) return null
  return `claude attach ${shellQuote(jobId)}`
}

/**
 * The worktree whose checkout contains `cwd`, by LONGEST path prefix — a
 * worktree nested under another checkout (e.g. `repo-wt-feat` beside `repo`)
 * must win over its parent. undefined when no open worktree contains the cwd;
 * the caller then has nowhere sensible to put the pane and should say so
 * rather than filing it under an arbitrary card.
 */
export function worktreeForCwd(
  cwd: string,
  worktrees: readonly { id: string; path: string }[]
): string | undefined {
  const dir = cwd.replace(/\/+$/, '')
  let best: { id: string; len: number } | undefined
  for (const wt of worktrees) {
    const p = wt.path.replace(/\/+$/, '')
    if (dir !== p && !dir.startsWith(`${p}/`)) continue
    if (!best || p.length > best.len) best = { id: wt.id, len: p.length }
  }
  return best?.id
}
