/**
 * A bounded, plain-text tail of what a pane has printed.
 *
 * Grove only ever kept the single bottom line of a session (for the sidebar
 * card). Letting one agent read another's recent output needs more than that,
 * but not the whole scrollback — this keeps a fixed number of finished lines and
 * drops the oldest, so a long-running agent cannot grow it without bound.
 *
 * Escape sequences are stripped on the way in, and a bare CR resets the current
 * line rather than appending to it: agents repaint their status/cost row in
 * place, so keeping the raw bytes would interleave stale and fresh frames (the
 * same reasoning as lastNonEmptyLine). This is a heuristic, not a terminal — it
 * cannot follow cursor-addressed repaints, and is meant for "roughly what did
 * this pane just say", not for reconstructing the screen.
 */
import { stripAnsi } from './ansi'

export class OutputBuffer {
  private readonly lines: string[] = []
  private partial = ''

  constructor(private readonly maxLines = 400) {}

  append(chunk: string): void {
    // Normalise CRLF first, so a Windows-style line end is one break rather than
    // a repaint-reset immediately followed by one.
    const text = stripAnsi(chunk).replace(/\r\n/g, '\n')
    for (const ch of text) {
      if (ch === '\n') {
        this.push(this.partial)
        this.partial = ''
      } else if (ch === '\r') {
        this.partial = '' // in-place repaint: the row starts over
      } else {
        this.partial += ch
      }
    }
  }

  private push(line: string): void {
    this.lines.push(line)
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines)
  }

  /**
   * The last `n` non-empty lines, oldest first. The line still being written is
   * included: an agent that is mid-answer has not printed its newline yet, and
   * omitting it would make `tail` look one step behind.
   */
  tail(n = 50): string[] {
    const all = [...this.lines, this.partial].map((l) => l.trimEnd()).filter(Boolean)
    return all.slice(Math.max(0, all.length - n))
  }
}
