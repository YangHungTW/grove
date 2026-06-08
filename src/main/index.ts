import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { SessionRegistry } from '../core/sessionRegistry'
import { PtySession } from '../core/session'
import { createWorktree, listWorktrees, removeWorktree, isGitRepo, worktreeStatus } from '../core/worktree'
import { ProjectStore, type ProjectEntry } from '../core/projectStore'
import { LayoutStore, type SessionDescriptor } from '../core/layoutStore'
import { detectState } from '../core/stateDetection'
import type { CreateWorktreeOptions } from '../core/worktree'
import {
  Channels,
  type CreateSessionRequest,
  type RendererApi,
  type SessionSnapshot,
  type WorktreeRemoveRequest
} from './ipc'
import type { Session } from '../core/types'

/** Main owns the single source of truth: the registry + live pty processes. */
const registry = new SessionRegistry()
const ptys = new Map<string, PtySession>()
let mainWindow: BrowserWindow | null = null
let projectStore: ProjectStore | null = null
let layoutStore: LayoutStore | null = null

/** Recent-projects store path: CCM_STORE override (tests) or Electron userData. */
function store(): ProjectStore {
  if (!projectStore) {
    const file = process.env.CCM_STORE ?? join(app.getPath('userData'), 'projects.json')
    projectStore = new ProjectStore(file)
  }
  return projectStore
}

/** Session-layout store path: CCM_LAYOUT override (tests) or Electron userData. */
function layout(): LayoutStore {
  if (!layoutStore) {
    const file = process.env.CCM_LAYOUT ?? join(app.getPath('userData'), 'layout.json')
    layoutStore = new LayoutStore(file)
  }
  return layoutStore
}

/** Validate + record a project by path. Throws if it is not a git repo. */
function addProject(repoRoot: string): ProjectEntry {
  if (!isGitRepo(repoRoot)) throw new Error(`not a git repository: ${repoRoot}`)
  return store().add(repoRoot)
}

function send(channel: string, payload: unknown): void {
  // A pty can emit data after the window/webContents is destroyed (close or
  // reload). Sending to a destroyed object throws "Object has been destroyed".
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function snapshot(s: Session): SessionSnapshot {
  return {
    id: s.id,
    worktreeId: s.worktreeId,
    kind: s.kind,
    title: s.title,
    cwd: s.cwd,
    state: s.state,
    pid: s.pid
  }
}

/**
 * How to launch a session's pty. Every session runs the user's default shell as
 * an interactive login shell ($SHELL -il, e.g. zsh) — exactly like opening a
 * terminal tab, so PATH/profile/aliases (and the p10k prompt) all apply. An
 * `agent` additionally has its command typed in (bootstrap), so the `claude`
 * alias expands. The agent command is overridable via CCM_AGENT_CMD (tests use
 * it to avoid real auth).
 */
function launchSpecFor(req: CreateSessionRequest): {
  command: string
  args?: string[]
  bootstrap?: string
} {
  const shell = process.env.SHELL || '/bin/zsh'
  if (req.kind === 'agent') {
    // Login NON-interactive shell: gets PATH from the profile but does NOT load
    // .zshrc/p10k, so the agent pane shows claude directly with no shell prompt.
    // (The `claude` alias's args aren't applied here; override via CCM_AGENT_CMD.)
    const agentCmd = process.env.CCM_AGENT_CMD ?? 'claude'
    return { command: shell, args: ['-lc', agentCmd] }
  }
  // A shell pane is an interactive login shell (p10k prompt expected).
  return { command: shell, args: ['-il'] }
}

function createSession(req: CreateSessionRequest): SessionSnapshot {
  // Registry enforces the single-agent-per-worktree invariant (may throw).
  const record = registry.addSession({
    worktreeId: req.worktreeId,
    kind: req.kind,
    title: req.title,
    cwd: req.cwd
  })

  const agent = req.agent ?? (req.kind === 'agent' ? 'claude' : '')
  const spec = launchSpecFor(req)
  const pty = new PtySession({
    id: record.id,
    worktreeId: req.worktreeId,
    kind: req.kind,
    command: spec.command,
    args: spec.args,
    bootstrap: spec.bootstrap,
    cwd: req.cwd,
    cols: req.cols,
    rows: req.rows,
    title: req.title
  })

  pty.onData((data) => {
    send(Channels.sessionData, { id: record.id, data })
    if (agent) {
      const next = detectState(data, agent)
      if (next !== record.state) {
        record.state = next
        pty.setState(next)
      }
    }
  })
  pty.onStateChange((state) => {
    record.state = state
    send(Channels.sessionStateChange, { id: record.id, state })
  })
  pty.onExit(({ exitCode, signal }) => {
    record.state = 'exited'
    send(Channels.sessionExit, { id: record.id, exitCode, signal })
    ptys.delete(record.id)
  })

  ptys.set(record.id, pty)
  try {
    pty.start()
  } catch (err) {
    // Spawn failed (e.g. shell not found) — roll back the registry record.
    ptys.delete(record.id)
    registry.removeSession(record.id)
    throw err
  }
  record.pid = pty.pid
  return snapshot(record)
}

function registerIpc(): void {
  ipcMain.handle(Channels.envRepoRoot, () => process.env.CCM_REPO_ROOT ?? process.cwd())

  ipcMain.handle(Channels.projectOpenDialog, async (): Promise<ProjectEntry | null> => {
    const res = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: 'Open project (git repository)',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return addProject(res.filePaths[0])
  })
  ipcMain.handle(Channels.projectAdd, (_e: IpcMainInvokeEvent, repoRoot: string) =>
    addProject(repoRoot)
  )
  ipcMain.handle(Channels.projectListRecent, () => store().list())
  ipcMain.handle(Channels.projectRemove, (_e: IpcMainInvokeEvent, repoRoot: string) =>
    store().remove(repoRoot)
  )
  ipcMain.handle(Channels.layoutLoad, () => layout().load())
  ipcMain.on(Channels.layoutSave, (_e, descriptors: SessionDescriptor[]) =>
    layout().save(descriptors)
  )

  ipcMain.handle(
    Channels.worktreeCreate,
    (_e: IpcMainInvokeEvent, repoRoot: string, opts: CreateWorktreeOptions) =>
      createWorktree(repoRoot, opts)
  )
  ipcMain.handle(Channels.worktreeList, (_e: IpcMainInvokeEvent, repoRoot: string) =>
    listWorktrees(repoRoot)
  )
  ipcMain.handle(Channels.worktreeStatus, (_e: IpcMainInvokeEvent, worktreePath: string) =>
    worktreeStatus(worktreePath)
  )
  ipcMain.handle(Channels.worktreeRemove, (_e: IpcMainInvokeEvent, req: WorktreeRemoveRequest) =>
    removeWorktree(req.repoRoot, req.path, { force: req.force })
  )

  ipcMain.handle(Channels.sessionCreate, (_e: IpcMainInvokeEvent, req: CreateSessionRequest) =>
    createSession(req)
  )
  ipcMain.handle(Channels.sessionList, (_e: IpcMainInvokeEvent, worktreeId?: string) =>
    (worktreeId ? registry.getSessions(worktreeId) : registry.all()).map(snapshot)
  )

  ipcMain.on(Channels.sessionInput, (_e, id: string, data: string) => ptys.get(id)?.write(data))
  ipcMain.on(Channels.sessionResize, (_e, id: string, cols: number, rows: number) =>
    ptys.get(id)?.resize(cols, rows)
  )
  ipcMain.on(Channels.sessionKill, (_e, id: string) => {
    ptys.get(id)?.kill()
    registry.removeSession(id)
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      // electron-vite emits the preload as .mjs under "type":"module".
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // When the window goes away, stop ptys and drop the ref so late pty data
  // events don't try to post to a destroyed webContents.
  mainWindow.on('closed', () => {
    for (const p of ptys.values()) p.kill()
    ptys.clear()
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const p of ptys.values()) p.kill()
  if (process.platform !== 'darwin') app.quit()
})

// Compile-time assurance the handlers cover the renderer surface.
export type _ApiContract = RendererApi
