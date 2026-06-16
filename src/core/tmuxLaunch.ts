/**
 * Pure launch helpers for durable (tmux control-mode) agent sessions. Kept
 * Electron-free so the launch string + session naming are unit-testable without
 * spawning anything. The main process turns these into a real pty.
 */

/**
 * Deterministic, tmux-safe session name for a worktree's durable agent. tmux
 * session names may not contain `.` or `:` (and `/` is best avoided), so collapse
 * anything outside `[A-Za-z0-9]` to `_`. There is at most one agent per worktree,
 * so this never collides, and it is stable across restarts (the key to reattach).
 */
export function tmuxSessionName(worktreeId: string): string {
  return `grove_${worktreeId.replace(/[^a-zA-Z0-9]/g, '_')}`
}

/**
 * Whether a session should launch in durable (tmux) mode: the user opted in AND
 * tmux is actually available. When tmux is missing we fall back to a direct
 * spawn rather than failing, so enabling the setting on a box without tmux is
 * harmless.
 */
export function durableEnabled(durableSessions: boolean, tmuxAvailable: boolean): boolean {
  return durableSessions && tmuxAvailable
}

/** Single-quote a string for safe embedding inside a POSIX `sh -lc '...'`. */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Build the launch for a durable agent via tmux CONTROL MODE. `tmux -CC` emits a
 * text protocol instead of drawing a screen (parsed by `TmuxControlParser`), so
 * the host renders pane bytes natively while the agent process lives on in a
 * persistent tmux session. `new-session -A` is create-or-reattach; `-x/-y` give
 * it a sane initial size (the control client is then sized via `refresh-client`).
 * Runs through a login shell so PATH resolves `tmux`; `exec` makes the pty's
 * process BE tmux so its exit cleanly signals the session end.
 */
export function buildTmuxControlLaunch(
  shell: string,
  name: string,
  cols: number,
  rows: number,
  agentCmd: string
): { command: string; args: string[] } {
  const tmuxCmd =
    `exec tmux -CC new-session -A -s ${name} -x ${cols} -y ${rows} ` +
    `${shell} -lc ${shSingleQuote(agentCmd)}`
  return { command: shell, args: ['-lc', tmuxCmd] }
}
