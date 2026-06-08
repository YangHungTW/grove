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
  layoutSave: (descriptors) => ipcRenderer.send(Channels.layoutSave, descriptors),
  layoutLoad: () => ipcRenderer.invoke(Channels.layoutLoad),
  worktreeCreate: (repoRoot: string, opts: CreateWorktreeOptions): Promise<WorktreeInfo> =>
    ipcRenderer.invoke(Channels.worktreeCreate, repoRoot, opts),
  worktreeList: (repoRoot: string): Promise<WorktreeInfo[]> =>
    ipcRenderer.invoke(Channels.worktreeList, repoRoot),
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
  onSessionData: (cb: (e: SessionDataEvent) => void) => subscribe(Channels.sessionData, cb),
  onSessionState: (cb: (e: SessionStateEvent) => void) =>
    subscribe(Channels.sessionStateChange, cb),
  onSessionExit: (cb: (e: SessionExitEvent) => void) => subscribe(Channels.sessionExit, cb)
}

contextBridge.exposeInMainWorld('api', api)
