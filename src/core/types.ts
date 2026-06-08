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
 * - `agent`  : a coding agent (Claude Code, etc.). At most ONE per worktree.
 * - `shell`  : an interactive shell.
 * - `server` : a long-running process (dev server).
 * - `task`   : a one-shot command (tests, build, git).
 */
export type SessionKind = 'agent' | 'shell' | 'server' | 'task'

/** Lifecycle / attention state of a session. */
export type SessionState = 'starting' | 'idle' | 'busy' | 'waiting' | 'exited'

/** A PTY-backed session living inside a worktree. */
export interface Session {
  id: string
  worktreeId: string
  kind: SessionKind
  title: string
  /** Working directory; defaults to the worktree path. */
  cwd?: string
  /** Command + args the session was spawned with, if any. */
  command?: string
  state: SessionState
  /** OS pid once spawned; undefined for registry-only records. */
  pid?: number
}

/** Fields a caller supplies when registering a session. */
export interface NewSession {
  worktreeId: string
  kind: SessionKind
  title?: string
  cwd?: string
  command?: string
  /** Optional explicit id (tests / restore); generated otherwise. */
  id?: string
  state?: SessionState
  pid?: number
}
