/**
 * Pure launch helpers for durable (tmux control-mode) agent sessions. Kept
 * Electron-free so the launch string + session naming are unit-testable without
 * spawning anything. The main process turns these into a real pty.
 */

/**
 * Deterministic, tmux-safe session name for a durable agent. tmux session names
 * may not contain `.` or `:` (and `/` is best avoided), so collapse anything
 * outside `[A-Za-z0-9]` to `_`.
 *
 * A worktree can hold MORE THAN ONE agent (e.g. "claude" + "claude 2"), so the
 * name must also include a per-agent `key` — otherwise the second agent's
 * `tmux new-session -A` (create-OR-attach) would attach to the first agent's
 * session and the two panes would share one terminal. The key is a stable,
 * persisted per-agent id (see `durableKey`), so the name is reproducible across
 * restarts — which is what lets a relaunch reattach to the still-live process.
 * `key` is optional only so old call sites / tests keep compiling.
 */
export function tmuxSessionName(worktreeId: string, key?: string): string {
  const wt = worktreeId.replace(/[^a-zA-Z0-9]/g, '_')
  const suffix = key ? `_${key.replace(/[^a-zA-Z0-9]/g, '_')}` : ''
  return `grove_${wt}${suffix}`
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

/**
 * Build the shell invocation that TEARS DOWN durable tmux sessions by name.
 *
 * Killing a durable session's pty only exits its `tmux -CC` control client — the
 * tmux session and the agent inside it live on. That is the right behaviour for
 * a Grove restart, but not for "the user closed this tab": without an explicit
 * kill-session every closed tab leaks a permanently-running agent process.
 *
 * Names are passed as POSITIONAL ARGS (never interpolated) so a worktree path
 * can't inject shell. `|| true` keeps an already-dead session from aborting the
 * loop. The shell is a LOGIN shell so tmux resolves on PATH — Electron launched
 * from Finder/Dock otherwise has a stripped PATH (same reason as openInEditor).
 */
export function buildTmuxKill(
  shell: string,
  names: string[]
): { command: string; args: string[] } {
  return {
    command: shell,
    args: ['-lc', 'for s in "$@"; do tmux kill-session -t "$s" || true; done', '--', ...names]
  }
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
 * The OUTER shell is a login shell (`-lc`) so PATH resolves `tmux`; `exec` makes
 * the pty's process BE tmux so its exit cleanly signals the session end. The INNER
 * shell that runs the agent is INTERACTIVE (`-ilc`) so it sources .zshrc and the
 * agent inherits the user's real PATH + aliases (e.g. a `claude` alias that adds
 * `--plugin-dir`) — matching the non-durable path and the user's own terminal.
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
    `${shell} -ilc ${shSingleQuote(agentCmd)}`
  return { command: shell, args: ['-lc', tmuxCmd] }
}
