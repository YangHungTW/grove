import type { SessionKind, SessionState } from '../core/types'
import type { WorktreeInfo, CreateWorktreeOptions, WorktreeStatus } from '../core/worktree'
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
  sessionCreate: 'session:create',
  sessionInput: 'session:input',
  sessionResize: 'session:resize',
  sessionKill: 'session:kill',
  sessionList: 'session:list',
  // events (main -> renderer)
  sessionData: 'session:data',
  sessionStateChange: 'session:state-change',
  sessionExit: 'session:exit'
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
  worktreeRemove(req: WorktreeRemoveRequest): Promise<void>
  sessionCreate(req: CreateSessionRequest): Promise<SessionSnapshot>
  sessionInput(id: string, data: string): void
  sessionResize(id: string, cols: number, rows: number): void
  sessionKill(id: string): void
  sessionList(worktreeId?: string): Promise<SessionSnapshot[]>
  onSessionData(cb: (e: SessionDataEvent) => void): () => void
  onSessionState(cb: (e: SessionStateEvent) => void): () => void
  onSessionExit(cb: (e: SessionExitEvent) => void): () => void
}
