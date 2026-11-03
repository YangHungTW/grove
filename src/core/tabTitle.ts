/**
 * Turning the terminal title an agent sets into a tab title.
 *
 * Claude Code writes an OSC 0 title on every status change: a glyph for the
 * state ("✳" idle, a spinner frame "◐◓◑◒" while busy) followed by the
 * conversation's title — which it generates itself once the topic is clear,
 * and before that is just "Claude Code". Grove mirrors that into the tab, so a
 * row of agents reads "Fix renderer leaks · Draft release notes" instead of
 * "claude · claude 2". Shell titles (zsh's cwd) are not fed through here.
 */

/** Longest tab title Grove will set on its own (a renamed tab has no limit). */
export const MAX_AUTO_TITLE = 60

/** Titles that name the program rather than the conversation. */
const GENERIC = new Set(['claude code', 'claude', 'codex', 'gemini', 'agent', 'terminal'])

/**
 * The tab title a raw terminal title should produce, or null when it carries no
 * information (empty, or just the agent's name): the tab then keeps whatever it
 * has. Leading symbols are dropped (that is where the status glyph lives), so a
 * spinner ticking over does not count as a new title.
 */
export function autoTabTitle(raw: string): string | null {
  let t = raw
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t || GENERIC.has(t.toLowerCase())) return null
  if (t.length > MAX_AUTO_TITLE) t = t.slice(0, MAX_AUTO_TITLE - 1).trimEnd() + '…'
  return t
}
