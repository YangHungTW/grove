/** Pure formatting helpers for the status bar's usage readout. */
import type { WorktreeUsage } from '../core/agentUsage'

/** Today's totals across every open worktree, for the status bar's right side.
 *
 * Cost is summed only over the worktrees that HAVE one: a model with no entry
 * in the price table contributes its tokens but no dollars, and pricing some of
 * the work at zero would quietly under-report the total. Null when nothing was
 * priced at all, which reads as "tokens only" rather than "$0.00".
 *
 * `contextTokens` is deliberately absent: it is one conversation's current
 * prompt size, so adding several together is a number that means nothing. */
export function sumUsage(all: Iterable<WorktreeUsage>): {
  tokens: number
  costUsd: number | null
  sessions: number
  worktrees: number
  /** Worktrees whose tokens are in the total but whose dollars are NOT, because
   * nothing prices their model. A dollar total that silently omits real work is
   * the number a reader is most likely to trust and most likely to be wrong
   * about, so the count travels with it and the UI says so. */
  unpriced: number
} {
  let tokens = 0
  let cost = 0
  let priced = false
  let sessions = 0
  let worktrees = 0
  let unpriced = 0
  for (const u of all) {
    worktrees++
    sessions += u.sessions
    tokens += u.input + u.output + u.cacheRead + u.cacheWrite
    if (u.costUsd != null) {
      cost += u.costUsd
      priced = true
    } else {
      unpriced++
    }
  }
  return { tokens, costUsd: priced ? cost : null, sessions, worktrees, unpriced }
}

/** Compact token count: 812 → "812", 45_300 → "45k", 1_240_000 → "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return n < 10_000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** "$0.0312" → "$0.03"; keeps two significant decimals for small amounts. */
export function formatUsd(x: number): string {
  if (x >= 0.995) return `$${x.toFixed(2)}`
  return x >= 0.01 ? `$${x.toFixed(2)}` : '<$0.01'
}

/** "claude-opus-4-8" → "opus 4.8"; "claude-fable-5" → "fable 5". Dated ids like
 * "claude-haiku-4-5-20251001" drop the date. Unknown shapes pass through with
 * the "claude-" prefix stripped. */
export function shortModel(model: string): string {
  const m = /(opus|sonnet|haiku|fable)[-_]?(\d{1,2})?(?:[-.](\d{1,2}))?(?!\d)/.exec(model)
  if (!m) return model.replace(/^claude-/, '')
  const ver = m[2] ? (m[3] ? `${m[2]}.${m[3]}` : m[2]) : ''
  return ver ? `${m[1]} ${ver}` : m[1]
}
