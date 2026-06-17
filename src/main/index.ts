import {
  app,
  BrowserWindow,
  Notification,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { join, resolve, basename, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { existsSync, copyFileSync } from 'node:fs'
import { stat as statAsync, readFile as readFileAsync } from 'node:fs/promises'
import { SessionRegistry } from '../core/sessionRegistry'
import { PtySession } from '../core/session'
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  isGitRepo,
  worktreeStatus,
  worktreeDiff,
  expandWorktreeTemplate,
  defaultBranch,
  commitAll,
  mergeIntoDefault,
  pushBranch
} from '../core/worktree'
import { prCreate, prStatus } from '../core/gh'
import { shellQuote } from '../core/shellQuote'
import { buildIdeOpenAction } from '../core/ideLaunch'
import { worktreeClaudeUsage } from '../core/claudeUsage'
import { ProjectStore, type ProjectEntry, type ProjectPatch } from '../core/projectStore'
import { LayoutStore, type SessionDescriptor } from '../core/layoutStore'
import { ClosedAgentsStore, type ClosedAgent } from '../core/closedAgentsStore'
import { SettingsStore, type AppSettings } from '../core/settingsStore'
import type { ResolvedAgent } from '../core/settings'
import { execFileSync } from 'node:child_process'
import { detectState } from '../core/stateDetection'
import { TmuxControlParser, toSendKeysHex } from '../core/tmuxControl'
import { buildTmuxControlLaunch, tmuxSessionName, durableEnabled } from '../core/tmuxLaunch'
import type { CreateWorktreeOptions } from '../core/worktree'
import {
  Channels,
  type CreateSessionRequest,
  type IdeOpenRequest,
  type RendererApi,
  type SessionSnapshot,
  type WorktreeRemoveRequest
} from './ipc'
import type { Session } from '../core/types'

/** Main owns the single source of truth: the registry + live pty processes. */
const registry = new SessionRegistry()
const ptys = new Map<string, PtySession>()
// Control-mode (CCM_TMUX=control) sessions: the pty runs `tmux -CC`, so its
// stdin/out is the tmux protocol, not raw terminal I/O. Input/resize must be
// translated to tmux commands instead of written to the pty directly.
const control = new Map<string, { name: string }>()
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
  const shell = process.env.SHELL || '/bin/zsh'
  // Pass the command name as a positional arg, not interpolated into the shell
  // string, so a setting like `claude; rm -rf ~` can't inject.
  const found = (flags: string): boolean => {
    try {
      execFileSync(shell, [flags, 'command -v "$1"', '--', first], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
  // Login non-interactive first (fast, no .zshrc). Fall back to interactive so an
  // agent installed as a shell ALIAS/function or only on the .zshrc PATH (e.g. a
  // `claude` alias) is still detected instead of showing as not-installed — the
  // picker only lists installed agents, so a false negative would hide it.
  const ok = found('-lc') || found('-ic')
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
 *
 * Substituted values are SHELL-QUOTED: branch/worktree/repo can contain shell
 * metacharacters (git allows `;` `|` `$()` backticks in branch names), so an
 * unquoted `{branch}` would be a command-injection vector when a hook runs.
 */
function runHook(cmd: string, cwd: string, extraEnv: Record<string, string>): void {
  if (!cmd || !cmd.trim()) return
  const expanded = cmd
    .replace(/\{worktree\}/g, shellQuote(extraEnv.CCM_WORKTREE_PATH ?? ''))
    .replace(/\{branch\}/g, shellQuote(extraEnv.CCM_BRANCH ?? ''))
    .replace(/\{repo\}/g, shellQuote(extraEnv.CCM_REPO ?? ''))
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
async function addProject(repoRoot: string): Promise<ProjectEntry> {
  if (!(await isGitRepo(repoRoot))) throw new Error(`not a git repository: ${repoRoot}`)
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
    viewerKind: s.viewerKind,
    durable: control.has(s.id) || undefined
  }
}

/**
 * The deterministic tmux session name for a worktree's durable agent, or
 * undefined when this session should NOT run under tmux. Durable mode is on when
 * the user opted in AND tmux is installed (falls back to a direct spawn when it
 * is missing), or when forced via CCM_TMUX=control (used in dev/e2e). One source
 * of truth for both launchSpecFor and createSession's control wiring.
 */
function durableAgentName(req: CreateSessionRequest): string | undefined {
  if (req.kind !== 'agent') return undefined
  const forced = process.env.CCM_TMUX === 'control'
  const on = forced || durableEnabled(settings().load().durableSessions, commandExists('tmux'))
  return on ? tmuxSessionName(req.worktreeId) : undefined
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
    // CCM_AGENT_CMD (a trusted env override, used by tests) takes precedence.
    const override = process.env.CCM_AGENT_CMD
    if (override) return { command: shell, args: ['-lc', override] }
    // Defense-in-depth: the command runs via `$SHELL -lc`, so a compromised
    // renderer could otherwise request an arbitrary command. The legitimate
    // value (built by buildAgentLaunch) always begins with a CONFIGURED agent
    // command, so require that prefix before handing it to the shell.
    const agentCmd = req.command ?? 'claude'
    const allowed = settings()
      .load()
      .agents.map((a) => a.command.trim())
      .filter(Boolean)
    const ok =
      allowed.length === 0 || allowed.some((ac) => agentCmd === ac || agentCmd.startsWith(`${ac} `))
    if (!ok) throw new Error(`agent command not allowed: ${agentCmd.split(/\s+/)[0]}`)
    // Durable sessions: when enabled (+ tmux installed) the agent runs under tmux
    // CONTROL MODE so it survives a Grove restart and reattaches to the live
    // process. tmux emits a text protocol instead of drawing — createSession parses
    // %output and renders pane bytes in xterm natively (the single renderer, so
    // scroll/search/selection stay native and there is no repaint ghosting).
    const name = durableAgentName(req)
    if (name) {
      return buildTmuxControlLaunch(shell, name, req.cols ?? 120, req.rows ?? 40, agentCmd)
    }
    return { command: shell, args: ['-lc', agentCmd] }
  }
  // A shell pane is an interactive login shell (p10k prompt expected). An optional
  // bootstrap (e.g. `vim <file>` from open-in-IDE) is typed in after the pty sizes.
  return { command: shell, args: ['-il'], bootstrap: req.bootstrap }
}

/**
 * Launch a GUI editor on `filePath` via a LOGIN shell, so it inherits the user's
 * real PATH — Electron started from Finder/Dock gets a stripped PATH and would
 * otherwise fail to find `code`/`cursor`/`subl`. The file path is passed as a
 * positional `"$1"` (never interpolated) so it can't inject; the editor command
 * comes from the trusted `ide` setting. CCM_IDE_CMD overrides the command in
 * tests (stands in for a real editor, like CCM_AGENT_CMD).
 */
function openInEditor(command: string, filePath: string, cwd: string): void {
  const shell = process.env.SHELL || '/bin/zsh'
  const editor = process.env.CCM_IDE_CMD || command
  try {
    execFile(shell, ['-lc', `${editor} "$1"`, '--', filePath], { cwd }, () => {})
  } catch {
    /* ignore launch errors — best-effort, like runHook */
  }
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
  const tmuxName = durableAgentName(req)
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
    title: req.title,
    // Control mode: read raw bytes (latin1) so the parser can reassemble a
    // multibyte char that tmux split across two %output messages.
    encoding: tmuxName ? 'latin1' : undefined
  })

  const forwardOutput = (data: string): void => {
    send(Channels.sessionData, { id: record.id, data })
    if (agent) {
      const next = detectState(data, agent)
      if (next !== record.state) {
        record.state = next
        pty.setState(next)
      }
    }
  }

  if (tmuxName) {
    // Control mode: the pty stream is the tmux protocol. Only %output carries the
    // pane's real bytes — and they're clean (no tmux chrome), so state detection
    // runs on exactly what xterm renders.
    const parser = new TmuxControlParser({
      onOutput: (_pane, data) => forwardOutput(data),
      onExit: () => {
        if (record.state === 'exited') return
        record.state = 'exited'
        send(Channels.sessionExit, { id: record.id, exitCode: 0 })
        ptys.delete(record.id)
        control.delete(record.id)
      },
      onOther: process.env.CCM_TMUX_DEBUG ? (l) => console.error('[tmux]', l) : undefined
    })
    pty.onData((d) => parser.feed(d))
    control.set(record.id, { name: tmuxName })
  } else {
    pty.onData(forwardOutput)
  }
  pty.onStateChange((state) => {
    record.state = state
    send(Channels.sessionStateChange, { id: record.id, state })
  })
  pty.onExit(({ exitCode, signal }) => {
    record.state = 'exited'
    send(Channels.sessionExit, { id: record.id, exitCode, signal })
    ptys.delete(record.id)
    control.delete(record.id)
  })

  ptys.set(record.id, pty)
  try {
    pty.start()
  } catch (err) {
    // Spawn failed (e.g. shell not found) — roll back the registry record.
    ptys.delete(record.id)
    control.delete(record.id)
    registry.removeSession(record.id)
    throw err
  }
  // A control client is inert at tmux's default 80x23 until told its size; this
  // initial sizing also makes tmux replay the pane so reattach shows content. The
  // renderer's first FitAddon resize is a different size → the resulting SIGWINCH
  // makes the agent repaint (needed because a bare replay does not).
  if (tmuxName) pty.write(`refresh-client -C ${req.cols ?? 120}x${req.rows ?? 40}\n`)
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
    async (_e: IpcMainInvokeEvent, repoRoot: string, opts: CreateWorktreeOptions) => {
      const path = opts.path ?? resolveWorktreePath(repoRoot, opts.branch)
      const info = await createWorktree(repoRoot, { ...opts, path })
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
  ipcMain.handle(Channels.worktreeCommitAll, (_e: IpcMainInvokeEvent, path: string, msg: string) =>
    commitAll(path, msg)
  )
  ipcMain.handle(
    Channels.worktreeMergeToDefault,
    (_e: IpcMainInvokeEvent, repoRoot: string, branch: string) => mergeIntoDefault(repoRoot, branch)
  )
  ipcMain.handle(Channels.worktreePush, (_e: IpcMainInvokeEvent, path: string) => pushBranch(path))
  ipcMain.handle(Channels.worktreeDefaultBranch, (_e: IpcMainInvokeEvent, repoRoot: string) =>
    defaultBranch(repoRoot)
  )
  ipcMain.handle(Channels.prCreate, (_e: IpcMainInvokeEvent, path: string) => {
    if (!commandExists('gh'))
      throw new Error('GitHub CLI (gh) not found — install it to create PRs from Grove')
    return prCreate(path)
  })
  ipcMain.handle(Channels.prStatus, (_e: IpcMainInvokeEvent, path: string) =>
    commandExists('gh') ? prStatus(path) : null
  )
  ipcMain.on(Channels.openExternal, (_e, url: string) => {
    // Only ever open web URLs — never file:// or custom schemes from the renderer.
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  ipcMain.handle(Channels.claudeUsage, (_e: IpcMainInvokeEvent, worktreePath: string) => {
    // "Today" in local time — the card shows what this worktree cost today.
    const since = new Date()
    since.setHours(0, 0, 0, 0)
    return worktreeClaudeUsage(worktreePath, since.getTime())
  })
  ipcMain.handle(
    Channels.worktreeRemove,
    async (_e: IpcMainInvokeEvent, req: WorktreeRemoveRequest) => {
      runHook(store().get(req.repoRoot)?.hookRemove ?? '', req.path, {
        CCM_WORKTREE_PATH: req.path,
        CCM_REPO: req.repoRoot
      })
      await removeWorktree(req.repoRoot, req.path, {
        force: req.force,
        deleteBranch: req.deleteBranch
      })
    }
  )

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
  ipcMain.handle(Channels.fileRead, async (_e: IpcMainInvokeEvent, filePath: string) => {
    const MAX = 5 * 1024 * 1024 // 5 MB — viewer panes are for human-readable files
    const { size } = await statAsync(filePath)
    if (size > MAX) {
      throw new Error(`File too large to preview (${(size / 1048576).toFixed(1)} MB; limit 5 MB)`)
    }
    return readFileAsync(filePath, 'utf8')
  })
  ipcMain.handle(
    Channels.ideOpen,
    (_e: IpcMainInvokeEvent, filePath: string, ctx: IdeOpenRequest): SessionSnapshot | null => {
      const ide = settings().load().ide
      if (!ide || !ide.command.trim()) throw new Error('No IDE configured — set one in Settings')
      const action = buildIdeOpenAction(ide, filePath, {
        worktreeId: ctx.worktreeId,
        cwd: ctx.cwd,
        cols: ctx.cols
      })
      // Terminal editor: open an in-app shell pane that runs `<editor> <file>`.
      if (action.mode === 'session') return createSession(action.request)
      // GUI editor: launch the process; no pane is created.
      openInEditor(action.command, action.filePath, ctx.cwd)
      return null
    }
  )

  ipcMain.on(Channels.sessionInput, (_e, id: string, data: string) => {
    const c = control.get(id)
    if (c) {
      // Control mode: deliver keystrokes as hex via send-keys, not raw pty write.
      if (data.length) ptys.get(id)?.write(`send-keys -t ${c.name} -H ${toSendKeysHex(data)}\n`)
      return
    }
    ptys.get(id)?.write(data)
  })
  ipcMain.on(Channels.sessionResize, (_e, id: string, cols: number, rows: number) => {
    if (process.env.CCM_DEBUG_RESIZE) console.log(`[resize] ${id} ${cols}x${rows}`)
    const c = control.get(id)
    if (c) {
      // Size the tmux window via the control client (auto-released on detach —
      // never resize-window, which freezes window-size to manual). This first
      // resize is also what makes tmux replay the screen at the correct geometry.
      ptys.get(id)?.write(`refresh-client -C ${cols}x${rows}\n`)
      return
    }
    ptys.get(id)?.resize(cols, rows)
  })
  ipcMain.on(Channels.sessionKill, (_e, id: string) => {
    // For a control session, killing the pty exits the -CC client; the tmux
    // session (and its agent) persists detached — that's the durability we want.
    ptys.get(id)?.kill()
    control.delete(id)
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

  // Hardening (defense-in-depth for rendered Markdown/HTML): never let the
  // renderer spawn new windows, and never let it navigate the main window away
  // from our own app (the classic Electron navigation-hijack vector).
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL
    if (url !== dev && !url.startsWith('file://')) e.preventDefault()
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
