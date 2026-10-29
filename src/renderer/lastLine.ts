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
import { stripAnsi } from '../core/ansi'


/** Best-effort last non-empty line of a raw pty chunk. Used only when a session
 * has no live xterm to read from (a background, non-selected worktree). Strips
 * ANSI and treats a bare CR as a row reset so an in-place-repainted status/cost
 * line doesn't concatenate a stale value onto the fresh one — e.g.
 * "$3,232,025\r$323.35" reads as "$323.35", not "…025$323.35". It cannot fully
 * emulate cursor-addressed (Ink-style) repaints; a visible pane should use
 * bufferLastLine, which reads the terminal's already-resolved screen.
 *
 * Runs on every pty chunk of every pane that is not on screen, so it must not
 * cost in proportion to the chunk: a background agent dumping a 64 KB tool
 * result is thousands of lines, of which one is wanted. Scan backwards from the
 * end and strip only the line that is returned. An OSC is the one escape that
 * may legally swallow a line break (and an unterminated one runs to the end of
 * the chunk), so a chunk carrying one is stripped whole first — same answer as
 * stripping everything, paid only when a title/hyperlink is in the chunk. */
export function lastNonEmptyLine(data: string): string | null {
  const stripped = data.includes('\x1b]')
  const s = stripped ? stripAnsi(data) : data
  let end = s.length
  while (end > 0) {
    let start = end
    while (start > 0) {
      const c = s.charCodeAt(start - 1)
      if (c === 10 /* \n */ || c === 13 /* \r */) break
      start--
    }
    const line = (stripped ? s.slice(start, end) : stripAnsi(s.slice(start, end))).trim()
    if (line) return line
    end = start - 1 // step over the terminator; \r\n leaves an empty line, skipped
  }
  return null
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

/**
 * The last `n` non-empty rows exactly as xterm rendered them, oldest first —
 * scrollback included. Serves the MCP `tail` tool: a claude pane repaints with
 * cursor addressing, so the raw pty stream holds interleaved stale frames and
 * chunk-split escapes; only the resolved buffer holds the screen as lines.
 * The scan is capped so a huge scrollback can't stall the renderer.
 */
export function bufferTail(term: Terminal, n: number, maxScan = 2000): string[] {
  const buf = term.buffer.active
  const out: string[] = []
  const end = buf.baseY + term.rows - 1
  const floor = Math.max(0, end - maxScan)
  for (let y = end; y >= floor && out.length < n; y--) {
    const text = buf.getLine(y)?.translateToString(true).trimEnd() ?? ''
    if (text.trim()) out.push(text)
  }
  return out.reverse()
}
