/** Extracting the "current bottom line" of a session for the sidebar card.
 *
 * Agents (e.g. Claude Code) render a status/cost line that they repaint IN PLACE
 * — returning the cursor to the row and rewriting it each tick. The raw pty byte
 * stream therefore interleaves stale and fresh frames; parsing it with a regex
 * is really re-implementing a terminal, and gets it wrong (a prior "$3,232,025"
 * and a fresh "$323.35" collapse into a garbled "3232025"). Prefer bufferLastLine
 * for a visible pane; fall back to lastNonEmptyLine only when no live term exists.
 */
import type { Terminal } from '@xterm/xterm'

// Strip ANSI/VT escape sequences INCLUDING the leading ESC (0x1b): CSI (ESC[…),
// OSC (ESC]… terminated by BEL or ST), and two-char/charset escapes. The old
// pattern matched the sequence body but left the ESC byte behind.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]|\x1b[()][A-Za-z0-9]/g

/** Best-effort last non-empty line of a raw pty chunk. Used only when a session
 * has no live xterm to read from (a background, non-selected worktree). Strips
 * ANSI and treats a bare CR as a row reset so an in-place-repainted status/cost
 * line doesn't concatenate a stale value onto the fresh one — e.g.
 * "$3,232,025\r$323.35" reads as "$323.35", not "…025$323.35". It cannot fully
 * emulate cursor-addressed (Ink-style) repaints; a visible pane should use
 * bufferLastLine, which reads the terminal's already-resolved screen. */
export function lastNonEmptyLine(data: string): string | null {
  const lines = data
    .replace(ANSI_RE, '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length ? lines[lines.length - 1] : null
}

/** The last non-empty visible row exactly as xterm rendered it — authoritative
 * for an in-place-repainted status/cost line, since xterm has already resolved
 * the cursor choreography that a regex over the raw stream cannot. */
export function bufferLastLine(term: Terminal): string | null {
  const buf = term.buffer.active
  for (let y = buf.baseY + term.rows - 1; y >= buf.baseY; y--) {
    const text = buf.getLine(y)?.translateToString(true).trim() ?? ''
    if (text) return text
  }
  return null
}
