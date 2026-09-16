/**
 * Token/cost readout for a worktree, across every agent that leaves a usage
 * trail on disk (Electron-free).
 *
 * Each agent CLI is its own provider: Claude Code writes JSONL transcripts under
 * `~/.claude/projects`, Codex writes rollout JSONL under `~/.codex/sessions`,
 * and an agent that records nothing simply has no provider. The rule throughout
 * is "report what you can prove": a provider that finds no session for this
 * worktree returns null and contributes nothing, and when no provider finds
 * anything the worktree has no usage to show at all — rather than a zero that
 * would read as "this agent was free".
 */
import type { WorktreeUsage } from './usageTypes'
import { worktreeClaudeUsage } from './claudeUsage'
import { worktreeCodexUsage } from './codexUsage'

export type { TranscriptUsage, WorktreeUsage } from './usageTypes'

/** Ask every agent that keeps a usage trail what this worktree spent. */
export type UsageProvider = (
  worktreePath: string,
  sinceMs: number,
  home?: string
) => Promise<WorktreeUsage | null>

export const USAGE_PROVIDERS: UsageProvider[] = [worktreeClaudeUsage, worktreeCodexUsage]

/**
 * Fold one agent's usage into the running total.
 *
 * Tokens and session counts add up. Cost adds up only over the parts that HAVE
 * a price — a model missing from a price table contributes its tokens and no
 * dollars, and pricing it at zero would quietly under-report the day. The model
 * name and the context size come from whichever agent spoke most recently,
 * because those two describe one conversation's current state, not a total:
 * adding two context sizes together produces a number that means nothing.
 */
export function mergeUsage(a: WorktreeUsage | null, b: WorktreeUsage | null): WorktreeUsage | null {
  if (!a) return b
  if (!b) return a
  const newest = b.lastTs >= a.lastTs ? b : a
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUsd: a.costUsd == null && b.costUsd == null ? null : (a.costUsd ?? 0) + (b.costUsd ?? 0),
    model: newest.model,
    contextTokens: newest.contextTokens,
    lastTs: newest.lastTs,
    sessions: a.sessions + b.sessions
  }
}

/**
 * Everything this worktree spent since `sinceMs`, across all agents. Null when
 * nothing was found — the caller shows nothing rather than an empty reading.
 *
 * A provider that throws is treated as "found nothing": one agent's log format
 * changing under us must not blank out the agents that still parse.
 */
export async function worktreeAgentUsage(
  worktreePath: string,
  sinceMs: number,
  home?: string,
  providers: UsageProvider[] = USAGE_PROVIDERS
): Promise<WorktreeUsage | null> {
  const found = await Promise.all(
    providers.map((p) => p(worktreePath, sinceMs, home).catch(() => null))
  )
  return found.reduce<WorktreeUsage | null>((acc, u) => mergeUsage(acc, u), null)
}
