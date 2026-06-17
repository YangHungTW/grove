/** Terminal key translation helpers for xterm's custom key-event handler. */

/** Minimal shape of the key events xterm forwards (a subset of KeyboardEvent). */
export interface TermKeyEvent {
  key: string
  type: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/**
 * Byte(s) to send for Shift+Enter, or null to let xterm handle the key normally.
 *
 * xterm sends a plain CR (`\r` = submit) for BOTH Enter and Shift+Enter. Agents
 * like Claude Code treat LF (`\x0a`, their Ctrl+J = chat:newline) as "insert a
 * newline" and CR as "submit", so on Shift+Enter we send LF instead. Only the
 * keydown produces output (keyup/keypress are ignored) so a single press emits one
 * byte. A plain shell's line editor binds both CR and LF to accept-line, so this is
 * safe for shell panes too (and fixes Shift+Enter when an agent is launched by hand
 * inside a shell).
 */
export function shiftEnterByte(e: TermKeyEvent): string | null {
  if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    return e.type === 'keydown' ? '\x0a' : ''
  }
  return null
}
