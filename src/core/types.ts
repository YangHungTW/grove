/** Core domain types shared across the engine (Electron-free). */

/** A git repository the app is managing. */
export interface Project {
  id: string
  repoRoot: string
}

/** A git worktree: a branch checked out at its own path. */
export interface Worktree {
  id: string
  path: string
  branch: string
  /** Base ref the worktree was created from, if known. */
  base?: string
}

/**
 * What a session is running.
 * - `agent`  : a coding agent (Claude Code, etc.). Multiple allowed per worktree.
 * - `shell`  : an interactive login shell ($SHELL).
 * - `viewer` : a non-terminal file viewer (Markdown/HTML). Has no pty.
 * - `diff`   : a non-terminal git-diff / code-review pane. Has no pty.
 */
export type SessionKind = 'agent' | 'shell' | 'viewer' | 'diff'

/** What a viewer session is rendering. `web` loads a live URL in an iframe;
 * `markdown`/`html` render a local file's contents. */
export type ViewerKind = 'markdown' | 'html' | 'web'

/** Lifecycle / attention state of a session. */
export type SessionState = 'starting' | 'idle' | 'busy' | 'waiting' | 'exited'

/** A PTY-backed session living inside a worktree. */
export interface Session {
  id: string
  worktreeId: string
  kind: SessionKind
  title: string
  /** Tab/sidebar icon (agent's icon or the shell icon). */
  icon?: string
  /** Working directory; defaults to the worktree path. */
  cwd?: string
  /** Command + args the session was spawned with, if any. */
  command?: string
  state: SessionState
  /** OS pid once spawned; undefined for registry-only records. */
  pid?: number
  /** Viewer sessions: absolute path of the opened file. */
  filePath?: string
  /** Viewer sessions: how to render `filePath`. */
  viewerKind?: ViewerKind
}

/** Fields a caller supplies when registering a session. */
export interface NewSession {
  worktreeId: string
  kind: SessionKind
  title?: string
  icon?: string
  cwd?: string
  command?: string
  /** Optional explicit id (tests / restore); generated otherwise. */
  id?: string
  state?: SessionState
  pid?: number
  filePath?: string
  viewerKind?: ViewerKind
}
