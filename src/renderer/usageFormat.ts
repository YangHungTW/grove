/** Pure formatting helpers for the worktree-card usage line. */

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
