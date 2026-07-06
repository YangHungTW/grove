import type { SessionKind, SessionState, ViewerKind } from '../core/types'
import type { WorktreeInfo, CreateWorktreeOptions, WorktreeStatus } from '../core/worktree'
import type { WorktreeUsage } from '../core/claudeUsage'
import type { PrInfo } from '../core/gh'
import type { ProjectEntry, ProjectPatch } from '../core/projectStore'
import type { SessionDescriptor } from '../core/layoutStore'
import type { ClosedAgent } from '../core/closedAgentsStore'
import type { AppSettings } from '../core/settingsStore'
import type { ResolvedAgent } from '../core/settings'

/** Channel names. Request/response (invoke) and event (send) are split. */
export const Channels = {
  envRepoRoot: 'env:repo-root',
  projectOpenDialog: 'project:open-dialog',
  projectAdd: 'project:add',
  projectListRecent: 'project:list-recent',
  projectRemove: 'project:remove',
  projectUpdate: 'project:update',
  layoutSave: 'layout:save',
  layoutLoad: 'layout:load',
  closedAgentsLoad: 'closed-agents:load',
  closedAgentsSave: 'closed-agents:save',
  settingsLoad: 'settings:load',
  settingsSave: 'settings:save',
  agentsAvailable: 'agents:available',
  worktreeCreate: 'worktree:create',
  worktreeList: 'worktree:list',
  worktreeRemove: 'worktree:remove',
  worktreeStatus: 'worktree:status',
  worktreeDiff: 'worktree:diff',
  worktreeCommitAll: 'worktree:commit-all',
  worktreeMergeToDefault: 'worktree:merge-default',
  worktreePush: 'worktree:push',
  worktreeDefaultBranch: 'worktree:default-branch',
  prCreate: 'pr:create',
  prStatus: 'pr:status',
  openExternal: 'shell:open-external',
  urlEmbeddable: 'url:embeddable',
  claudeUsage: 'claude:usage',
  sessionCreate: 'session:create',
  sessionInput: 'session:input',
  sessionResize: 'session:resize',
  sessionKill: 'session:kill',
  sessionList: 'session:list',
  fileOpenDialog: 'file:open-dialog',
  fileRead: 'file:read',
  ideOpen: 'ide:open',
  notifyAttention: 'notify:attention',
  notifyBadge: 'notify:badge',
  // events (main -> renderer)
  sessionData: 'session:data',
  sessionStateChange: 'session:state-change',
  sessionExit: 'session:exit',
  notifyJump: 'notify:jump',
  hookFailed: 'hook:failed'
} as const

/** Serializable view of a session sent across the IPC boundary. */
export interface SessionSnapshot {
  id: string
  worktreeId: string
  kind: SessionKind
  title: string
  icon?: string
  cwd?: string
  state: SessionState
  pid?: number
  /** Viewer sessions: absolute path of the opened file. */
  filePath?: string
  /** Viewer sessions: how to render `filePath`. */
  viewerKind?: ViewerKind
  /** Durable (tmux control-mode) agent: survives a Grove restart and reattaches. */
  durable?: boolean
}

export interface CreateSessionRequest {
  worktreeId: string
  kind: SessionKind
  command: string
  args?: string[]
  cwd?: string
  title?: string
  icon?: string
  cols?: number
  rows?: number
  /** Agent id used for state detection (e.g. 'claude'); defaults from kind. */
  agent?: string
  /** Stable per-agent id for durable (tmux) sessions. Folded into the tmux
   * session name so multiple agents in one worktree don't collide onto a single
   * session; persisted + restored so a relaunch reattaches to the right one. */
  durableKey?: string
  /** Viewer sessions: file to open + how to render it (no pty is spawned). */
  filePath?: string
  viewerKind?: ViewerKind
  /** Input written into the shell pty after spawn (e.g. `vim <file>\r` for the
   * open-in-IDE terminal-editor path). Honored for `shell` sessions. */
  bootstrap?: string
}

/** Context the renderer supplies when opening a file in the configured IDE. */
export interface IdeOpenRequest {
  worktreeId: string
  /** Working directory for the launched editor / shell (the worktree path). */
  cwd: string
  cols?: number
}

export interface SessionDataEvent {
  id: string
  data: string
}
export interface SessionStateEvent {
  id: string
  state: SessionState
}
export interface SessionExitEvent {
  id: string
  exitCode: number
  signal?: number
}
export interface HookFailedEvent {
  /** Which per-project hook failed. */
  kind: 'create' | 'remove'
  /** The configured command (post-placeholder-expansion) that was run. */
  command: string
  /** Exit code (null if the shell could not be spawned at all). */
  code: number | null
  /** Combined stdout+stderr tail, for the toast/log. */
  output: string
}

export interface WorktreeRemoveRequest {
  repoRoot: string
  path: string
  force?: boolean
  /** Branch to delete after removing the worktree (omit to keep the branch). */
  deleteBranch?: string
}

/**
 * The surface exposed to the renderer via contextBridge (`window.api`).
 * Defined once so preload, renderer, and main stay in lock-step.
 */
export interface RendererApi {
  /** The repo root the app was launched against (CCM_REPO_ROOT or cwd). */
  repoRoot(): Promise<string>
  /** Open a native folder picker; validates it is a git repo. null if cancelled. */
  projectOpenDialog(): Promise<ProjectEntry | null>
  /** Add a project by path (validates git repo; rejects otherwise). */
  projectAdd(repoRoot: string): Promise<ProjectEntry>
  /** Recently-opened projects, most-recent first. */
  projectListRecent(): Promise<ProjectEntry[]>
  projectRemove(repoRoot: string): Promise<void>
  projectUpdate(repoRoot: string, patch: ProjectPatch): void
  /** Persist the open-session layout for restore on next launch. */
  layoutSave(descriptors: SessionDescriptor[]): void
  layoutLoad(): Promise<SessionDescriptor[]>
  /** Recently-closed resumable agents, persisted for one-click resume. */
  closedAgentsLoad(): Promise<ClosedAgent[]>
  closedAgentsSave(list: ClosedAgent[]): void
  settingsLoad(): Promise<AppSettings>
  settingsSave(patch: Partial<AppSettings>): Promise<AppSettings>
  /** All configured agents tagged with whether their command is installed. */
  agentsAvailable(): Promise<ResolvedAgent[]>
  worktreeCreate(repoRoot: string, opts: CreateWorktreeOptions): Promise<WorktreeInfo>
  worktreeList(repoRoot: string): Promise<WorktreeInfo[]>
  worktreeStatus(worktreePath: string): Promise<WorktreeStatus>
  /** Unified diff of everything a worktree changed (committed vs base + uncommitted). */
  worktreeDiff(worktreePath: string, baseRef?: string): Promise<string>
  /** Today's Claude Code token/cost usage for sessions launched in a worktree
   * (read from `~/.claude/projects` transcripts; null when there are none). */
  claudeUsage(worktreePath: string): Promise<WorktreeUsage | null>
  /** Stage everything in a worktree and commit (throws on a clean tree). */
  worktreeCommitAll(worktreePath: string, message: string): Promise<void>
  /** Merge a worktree's branch into the repo's default branch (run from the
   * primary worktree, which must be clean and on the default branch). Returns
   * the target branch name. */
  worktreeMergeToDefault(repoRoot: string, branch: string): Promise<string>
  /** `git push -u origin HEAD` for a worktree. */
  worktreePush(worktreePath: string): Promise<void>
  worktreeDefaultBranch(repoRoot: string): Promise<string>
  /** `gh pr create --fill`; returns the PR URL. Throws when gh is missing. */
  prCreate(worktreePath: string): Promise<string>
  /** PR + CI summary for the worktree's branch (null: no PR / no gh). */
  prStatus(worktreePath: string): Promise<PrInfo | null>
  /** Open an http(s) URL in the default browser. */
  openExternal(url: string): void
  /** Whether an http(s) URL can be shown in an in-app iframe (no X-Frame-Options
   * / restrictive CSP frame-ancestors). false → caller should open it externally.
   * Optimistic: network/timeout errors resolve true. */
  urlEmbeddable(url: string): Promise<boolean>
  worktreeRemove(req: WorktreeRemoveRequest): Promise<void>
  sessionCreate(req: CreateSessionRequest): Promise<SessionSnapshot>
  sessionInput(id: string, data: string): void
  sessionResize(id: string, cols: number, rows: number): void
  sessionKill(id: string): void
  sessionList(worktreeId?: string): Promise<SessionSnapshot[]>
  /** Open a native picker for a Markdown/HTML file, starting in `defaultPath`
   * (the worktree folder). null if cancelled. */
  fileOpenDialog(defaultPath?: string): Promise<string | null>
  /** Read a UTF-8 file's contents (used by viewer panes). */
  fileRead(filePath: string): Promise<string>
  /** Open `filePath` in the user's configured IDE. A terminal editor (vim) opens
   * in a new in-app shell pane (returns its snapshot to place); a GUI editor is
   * launched as a process (returns null). Throws when no IDE is configured. */
  ideOpen(filePath: string, ctx: IdeOpenRequest): Promise<SessionSnapshot | null>
  /** Absolute path of a dragged-in File (preload-only; no IPC round-trip). */
  pathForFile(file: File): string
  /** Fire an OS notification that a session needs input (no-op if Grove is focused). */
  notifyAttention(id: string, title: string): void
  /** Set the Dock/taskbar badge to the pending-session count (0 clears it). */
  setBadgeCount(count: number): void
  onSessionData(cb: (e: SessionDataEvent) => void): () => void
  onSessionState(cb: (e: SessionStateEvent) => void): () => void
  onSessionExit(cb: (e: SessionExitEvent) => void): () => void
  /** A clicked OS notification asks the renderer to focus that session. */
  onNotifyJump(cb: (e: { id: string }) => void): () => void
  /** A per-project create/remove hook exited non-zero (or failed to spawn). */
  onHookFailed(cb: (e: HookFailedEvent) => void): () => void
}
