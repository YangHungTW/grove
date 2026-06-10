import { app, BrowserWindow, Notification, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join, resolve, basename, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { existsSync, copyFileSync, readFileSync } from 'node:fs'
import { SessionRegistry } from '../core/sessionRegistry'
import { PtySession } from '../core/session'
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  isGitRepo,
  worktreeStatus,
  worktreeDiff,
  expandWorktreeTemplate
} from '../core/worktree'
import { ProjectStore, type ProjectEntry, type ProjectPatch } from '../core/projectStore'
import { LayoutStore, type SessionDescriptor } from '../core/layoutStore'
import { ClosedAgentsStore, type ClosedAgent } from '../core/closedAgentsStore'
import { SettingsStore, type AppSettings } from '../core/settingsStore'
import type { ResolvedAgent } from '../core/settings'
import { execFileSync } from 'node:child_process'
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

let closedAgentsStore: ClosedAgentsStore | null = null
/** Recently-closed agents store path: CCM_CLOSED_AGENTS override or userData. */
function closedAgents(): ClosedAgentsStore {
  if (!closedAgentsStore) {
    const file =
      process.env.CCM_CLOSED_AGENTS ?? join(app.getPath('userData'), 'closed-agents.json')
    closedAgentsStore = new ClosedAgentsStore(file)
  }
  return closedAgentsStore
}

let settingsStore: SettingsStore | null = null
function settings(): SettingsStore {
  if (!settingsStore) {
    const file = process.env.CCM_SETTINGS ?? join(app.getPath('userData'), 'settings.json')
    settingsStore = new SettingsStore(file)
  }
  return settingsStore
}

const installedCache = new Map<string, boolean>()
/** Is a command on PATH? Checked via a login shell (GUI apps lack shell PATH). */
function commandExists(cmd: string): boolean {
  const first = cmd.trim().split(/\s+/)[0]
  if (installedCache.has(first)) return installedCache.get(first)!
  let ok = false
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    execFileSync(shell, ['-lc', `command -v ${first}`], { stdio: 'ignore' })
    ok = true
  } catch {
    ok = false
  }
  installedCache.set(first, ok)
  return ok
}

/** All configured agents, each tagged with whether its command is on PATH. */
function resolveAgents(): ResolvedAgent[] {
  return settings()
    .load()
    .agents.map((a) => ({ ...a, installed: commandExists(a.command) }))
}

/** Resolve a new worktree path from the settings template (relative to repo). */
function resolveWorktreePath(repoRoot: string, branch: string): string {
  const tmpl = settings().load().worktreeFolder || '../{repo}-wt-{branch}'
  const sub = expandWorktreeTemplate(tmpl, { repo: basename(repoRoot), branch, now: new Date() })
  return resolve(repoRoot, sub)
}

/**
 * Run a user hook (fire-and-forget) in a login shell. The command can be any
 * shell command, a script path, or an agent invocation (e.g. `agy -p "/setup"`).
 * {worktree}/{branch}/{repo} placeholders are expanded; the same values are also
 * exposed as $CCM_WORKTREE_PATH / $CCM_BRANCH / $CCM_REPO.
 */
function runHook(cmd: string, cwd: string, extraEnv: Record<string, string>): void {
  if (!cmd || !cmd.trim()) return
  const expanded = cmd
    .replace(/\{worktree\}/g, extraEnv.CCM_WORKTREE_PATH ?? '')
    .replace(/\{branch\}/g, extraEnv.CCM_BRANCH ?? '')
    .replace(/\{repo\}/g, extraEnv.CCM_REPO ?? '')
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    execFile(shell, ['-lc', expanded], { cwd, env: { ...process.env, ...extraEnv } }, () => {})
  } catch {
    /* ignore hook errors */
  }
}

/** Apply appearance settings (vibrancy/background) to the window. */
function applyAppearance(s: AppSettings): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.setVibrancy(s.transparent ? 'under-window' : null)
    mainWindow.setBackgroundColor(s.transparent ? '#00000000' : s.background)
  } catch {
    /* vibrancy unsupported on this platform */
  }
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
    icon: s.icon,
    cwd: s.cwd,
    state: s.state,
    pid: s.pid,
    filePath: s.filePath,
    viewerKind: s.viewerKind
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
    // .zshrc/p10k, so the agent pane shows the CLI directly with no shell prompt.
    // The agent command comes from the renderer (req.command); CCM_AGENT_CMD
    // overrides it (used by tests to avoid real auth).
    const agentCmd = process.env.CCM_AGENT_CMD ?? req.command ?? 'claude'
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
    icon: req.icon,
    cwd: req.cwd,
    filePath: req.filePath,
    viewerKind: req.viewerKind,
    // Non-pty panes (viewer/diff) are inert from the start — no 'starting' state.
    state: req.kind === 'viewer' || req.kind === 'diff' ? 'idle' : undefined
  })

  // Viewer/diff panes render content, not a pty — skip the whole spawn path.
  // sessionInput/resize/kill all key off the `ptys` map, so they no-op safely.
  if (req.kind === 'viewer' || req.kind === 'diff') return snapshot(record)

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
  ipcMain.on(Channels.projectUpdate, (_e, repoRoot: string, patch: ProjectPatch) =>
    store().update(repoRoot, patch)
  )
  ipcMain.handle(Channels.layoutLoad, () => layout().load())
  ipcMain.on(Channels.layoutSave, (_e, descriptors: SessionDescriptor[]) =>
    layout().save(descriptors)
  )
  ipcMain.handle(Channels.closedAgentsLoad, () => closedAgents().load())
  ipcMain.on(Channels.closedAgentsSave, (_e, list: ClosedAgent[]) => closedAgents().save(list))
  ipcMain.handle(Channels.agentsAvailable, () => resolveAgents())
  ipcMain.handle(Channels.settingsLoad, () => settings().load())
  ipcMain.handle(Channels.settingsSave, (_e: IpcMainInvokeEvent, patch: Partial<AppSettings>) => {
    const next = settings().save(patch)
    applyAppearance(next)
    return next
  })

  ipcMain.handle(
    Channels.worktreeCreate,
    (_e: IpcMainInvokeEvent, repoRoot: string, opts: CreateWorktreeOptions) => {
      const path = opts.path ?? resolveWorktreePath(repoRoot, opts.branch)
      const info = createWorktree(repoRoot, { ...opts, path })
      runHook(store().get(repoRoot)?.hookCreate ?? '', info.path, {
        CCM_WORKTREE_PATH: info.path,
        CCM_BRANCH: info.branch,
        CCM_REPO: repoRoot
      })
      return info
    }
  )
  ipcMain.handle(Channels.worktreeList, (_e: IpcMainInvokeEvent, repoRoot: string) =>
    listWorktrees(repoRoot)
  )
  ipcMain.handle(Channels.worktreeStatus, (_e: IpcMainInvokeEvent, worktreePath: string) =>
    worktreeStatus(worktreePath)
  )
  ipcMain.handle(
    Channels.worktreeDiff,
    (_e: IpcMainInvokeEvent, worktreePath: string, baseRef?: string) =>
      worktreeDiff(worktreePath, baseRef)
  )
  ipcMain.handle(Channels.worktreeRemove, (_e: IpcMainInvokeEvent, req: WorktreeRemoveRequest) => {
    runHook(store().get(req.repoRoot)?.hookRemove ?? '', req.path, {
      CCM_WORKTREE_PATH: req.path,
      CCM_REPO: req.repoRoot
    })
    removeWorktree(req.repoRoot, req.path, { force: req.force, deleteBranch: req.deleteBranch })
  })

  ipcMain.handle(Channels.sessionCreate, (_e: IpcMainInvokeEvent, req: CreateSessionRequest) =>
    createSession(req)
  )
  ipcMain.handle(Channels.sessionList, (_e: IpcMainInvokeEvent, worktreeId?: string) =>
    (worktreeId ? registry.getSessions(worktreeId) : registry.all()).map(snapshot)
  )

  ipcMain.handle(
    Channels.fileOpenDialog,
    async (_e: IpcMainInvokeEvent, defaultPath?: string): Promise<string | null> => {
      const res = await dialog.showOpenDialog(mainWindow ?? undefined!, {
        title: 'Open file',
        // Start the picker in the worktree folder.
        defaultPath: defaultPath || undefined,
        properties: ['openFile'],
        filters: [
          { name: 'Viewable', extensions: ['md', 'markdown', 'html', 'htm'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      if (res.canceled || res.filePaths.length === 0) return null
      return res.filePaths[0]
    }
  )
  ipcMain.handle(Channels.fileRead, (_e: IpcMainInvokeEvent, filePath: string) =>
    readFileSync(filePath, 'utf8')
  )

  ipcMain.on(Channels.sessionInput, (_e, id: string, data: string) => ptys.get(id)?.write(data))
  ipcMain.on(Channels.sessionResize, (_e, id: string, cols: number, rows: number) =>
    ptys.get(id)?.resize(cols, rows)
  )
  ipcMain.on(Channels.sessionKill, (_e, id: string) => {
    ptys.get(id)?.kill()
    registry.removeSession(id)
  })

  // OS notification when an agent needs input and Grove isn't the focused window.
  // Clicking it brings Grove forward and jumps to that session.
  ipcMain.on(Channels.notifyAttention, (_e, id: string, title: string) => {
    if (!Notification.isSupported() || mainWindow?.isFocused()) return
    const n = new Notification({ title: 'Grove', body: `${title} needs your attention` })
    n.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
        send(Channels.notifyJump, { id })
      }
    })
    n.show()
  })

  // Dock/taskbar badge = number of sessions waiting on the user (0 clears it).
  ipcMain.on(Channels.notifyBadge, (_e, count: number) => {
    try {
      app.setBadgeCount(Math.max(0, count | 0))
    } catch {
      /* unsupported platform */
    }
  })
}

/** One-time: carry settings/projects/layout over from the old app-name folder
 * (Electron's userData path changed when the app was renamed to Grove). */
function migrateUserData(): void {
  try {
    const dir = app.getPath('userData')
    const old = join(dirname(dir), 'ccmanager-gui')
    if (old === dir || !existsSync(old)) return
    for (const f of ['settings.json', 'projects.json', 'layout.json']) {
      const dst = join(dir, f)
      const src = join(old, f)
      if (existsSync(src) && !existsSync(dst)) copyFileSync(src, dst)
    }
  } catch {
    /* best-effort */
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: 'Grove',
    // Vibrancy (frosted glass) rather than `transparent: true`: on macOS a truly
    // transparent window breaks GPU compositing and the xterm canvas/WebGL
    // renderer paints blank. Vibrancy keeps the terminal rendering while still
    // letting the background show through (frosted) when transparency is on.
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      // electron-vite emits the preload as .mjs under "type":"module".
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    applyAppearance(settings().load())
    mainWindow?.show()
  })

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
  migrateUserData()
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
