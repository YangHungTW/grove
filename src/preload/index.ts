import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  Channels,
  type CreateSessionRequest,
  type RendererApi,
  type SessionDataEvent,
  type SessionExitEvent,
  type SessionSnapshot,
  type SessionStateEvent,
  type WorktreeRemoveRequest
} from '../main/ipc'
import type { CreateWorktreeOptions, WorktreeInfo } from '../core/worktree'

function subscribe<T>(channel: string, cb: (e: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: RendererApi = {
  repoRoot: (): Promise<string> => ipcRenderer.invoke(Channels.envRepoRoot),
  projectOpenDialog: () => ipcRenderer.invoke(Channels.projectOpenDialog),
  projectAdd: (repoRoot: string) => ipcRenderer.invoke(Channels.projectAdd, repoRoot),
  projectListRecent: () => ipcRenderer.invoke(Channels.projectListRecent),
  projectRemove: (repoRoot: string) => ipcRenderer.invoke(Channels.projectRemove, repoRoot),
  projectUpdate: (repoRoot, patch) => ipcRenderer.send(Channels.projectUpdate, repoRoot, patch),
  layoutSave: (descriptors) => ipcRenderer.send(Channels.layoutSave, descriptors),
  layoutLoad: () => ipcRenderer.invoke(Channels.layoutLoad),
  closedAgentsLoad: () => ipcRenderer.invoke(Channels.closedAgentsLoad),
  closedAgentsSave: (list) => ipcRenderer.send(Channels.closedAgentsSave, list),
  settingsLoad: () => ipcRenderer.invoke(Channels.settingsLoad),
  settingsSave: (patch) => ipcRenderer.invoke(Channels.settingsSave, patch),
  agentsAvailable: () => ipcRenderer.invoke(Channels.agentsAvailable),
  worktreeCreate: (repoRoot: string, opts: CreateWorktreeOptions): Promise<WorktreeInfo> =>
    ipcRenderer.invoke(Channels.worktreeCreate, repoRoot, opts),
  worktreeList: (repoRoot: string): Promise<WorktreeInfo[]> =>
    ipcRenderer.invoke(Channels.worktreeList, repoRoot),
  worktreeStatus: (worktreePath: string) =>
    ipcRenderer.invoke(Channels.worktreeStatus, worktreePath),
  worktreeDiff: (worktreePath: string, baseRef?: string): Promise<string> =>
    ipcRenderer.invoke(Channels.worktreeDiff, worktreePath, baseRef),
  claudeUsage: (worktreePath: string) => ipcRenderer.invoke(Channels.claudeUsage, worktreePath),
  worktreeCommitAll: (worktreePath: string, message: string): Promise<void> =>
    ipcRenderer.invoke(Channels.worktreeCommitAll, worktreePath, message),
  worktreeMergeToDefault: (repoRoot: string, branch: string): Promise<string> =>
    ipcRenderer.invoke(Channels.worktreeMergeToDefault, repoRoot, branch),
  worktreePush: (worktreePath: string): Promise<void> =>
    ipcRenderer.invoke(Channels.worktreePush, worktreePath),
  worktreeDefaultBranch: (repoRoot: string): Promise<string> =>
    ipcRenderer.invoke(Channels.worktreeDefaultBranch, repoRoot),
  prCreate: (worktreePath: string): Promise<string> =>
    ipcRenderer.invoke(Channels.prCreate, worktreePath),
  prStatus: (worktreePath) => ipcRenderer.invoke(Channels.prStatus, worktreePath),
  openExternal: (url: string): void => {
    ipcRenderer.send(Channels.openExternal, url)
  },
  worktreeRemove: (req: WorktreeRemoveRequest): Promise<void> =>
    ipcRenderer.invoke(Channels.worktreeRemove, req),
  sessionCreate: (req: CreateSessionRequest): Promise<SessionSnapshot> =>
    ipcRenderer.invoke(Channels.sessionCreate, req),
  sessionInput: (id: string, data: string): void => {
    ipcRenderer.send(Channels.sessionInput, id, data)
  },
  sessionResize: (id: string, cols: number, rows: number): void => {
    ipcRenderer.send(Channels.sessionResize, id, cols, rows)
  },
  sessionKill: (id: string): void => {
    ipcRenderer.send(Channels.sessionKill, id)
  },
  sessionList: (worktreeId?: string): Promise<SessionSnapshot[]> =>
    ipcRenderer.invoke(Channels.sessionList, worktreeId),
  fileOpenDialog: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke(Channels.fileOpenDialog, defaultPath),
  fileRead: (filePath: string): Promise<string> => ipcRenderer.invoke(Channels.fileRead, filePath),
  notifyAttention: (id: string, title: string): void => {
    ipcRenderer.send(Channels.notifyAttention, id, title)
  },
  setBadgeCount: (count: number): void => {
    ipcRenderer.send(Channels.notifyBadge, count)
  },
  onSessionData: (cb: (e: SessionDataEvent) => void) => subscribe(Channels.sessionData, cb),
  onSessionState: (cb: (e: SessionStateEvent) => void) =>
    subscribe(Channels.sessionStateChange, cb),
  onSessionExit: (cb: (e: SessionExitEvent) => void) => subscribe(Channels.sessionExit, cb),
  onNotifyJump: (cb: (e: { id: string }) => void) => subscribe(Channels.notifyJump, cb)
}

contextBridge.exposeInMainWorld('api', api)
