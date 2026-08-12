import {
  app,
  BrowserWindow,
  Notification,
  dialog,
  ipcMain,
  protocol,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { join, resolve, basename, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import {
  existsSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  watch
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { OutputBuffer } from '../core/outputBuffer'
import { buildMcpConfig } from '../core/mcpConfig'
import { GroveMcpServer, type McpHost } from './mcpServer'
import { homedir } from 'node:os'
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
import { discoverSkills, type SkillFs } from '../core/skills'
import { buildIdeOpenAction } from '../core/ideLaunch'
import { resolveUserPath } from '../core/userPath'
import { parseFrameability } from '../core/openTarget'
import { viewerMime } from '../core/viewerMime'
import { describeViewerReadError } from '../core/viewerError'
import { HTML_VIEWER_SCHEME, htmlViewerPath } from '../core/htmlViewerUrl'
import { worktreeClaudeUsage } from '../core/claudeUsage'
import { ProjectStore, type ProjectEntry, type ProjectPatch } from '../core/projectStore'
import { LayoutStore, type SessionDescriptor } from '../core/layoutStore'
import { ClosedAgentsStore, type ClosedAgent } from '../core/closedAgentsStore'
import { SettingsStore, type AppSettings } from '../core/settingsStore'
import type { ResolvedAgent } from '../core/settings'
import { execFileSync } from 'node:child_process'
import { detectState } from '../core/stateDetection'
import { TmuxControlParser, toSendKeysHex } from '../core/tmuxControl'
import {
  parseRegistryEntry,
  registryUpdates,
  unjoinedEntries,
  type RegistryEntry
} from '../core/claudeRegistry'
import {
  buildTmuxControlLaunch,
  buildTmuxKill,
  tmuxSessionName,
  durableEnabled
} from '../core/tmuxLaunch'
import type { CreateWorktreeOptions } from '../core/worktree'
import {
  Channels,
  type CreateSessionRequest,
  type HookFailedEvent,
  type IdeOpenRequest,
  type RendererApi,
  type SessionSnapshot,
  type WorktreeRemoveRequest
} from './ipc'
import type { Session } from '../core/types'

// Custom scheme for the in-app HTML viewer. An agent-generated report is served
// from here (not via <iframe srcdoc>) so it lives in its OWN origin: a srcdoc /
// data: / blob: frame INHERITS the renderer's CSP (`script-src 'self'`), which
// silently kills the report's inline <script> (TOC scroll, etc.). A document
// fetched from a real registered scheme carries no inherited CSP, so its
// scripts run. The frame is still sandboxed without allow-same-origin, so it
// sits in an opaque origin and can't reach window.api or the parent DOM.
// (Scheme + URL shape live in core/htmlViewerUrl, shared with the renderer.)
protocol.registerSchemesAsPrivileged([
  { scheme: HTML_VIEWER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

/** Main owns the single source of truth: the registry + live pty processes. */
const registry = new SessionRegistry()
const ptys = new Map<string, PtySession>()
// Control-mode (CCM_TMUX=control) sessions: the pty runs `tmux -CC`, so its
// stdin/out is the tmux protocol, not raw terminal I/O. Input/resize must be
// translated to tmux commands instead of written to the pty directly.
const control = new Map<string, { name: string }>()
// Claude's own session registry (~/.claude/sessions/<pid>.json): authoritative
// busy/idle/waiting, computed from the CLI's UI state rather than scraped out of
// its output. `agentSessionIds` is the join — Grove session id → the uuid Grove
// pinned with `--session-id` — and `waitingReason` carries the human-readable
// "why" alongside a waiting state.
const agentSessionIds = new Map<string, string>()
const waitingReason = new Map<string, string>()
let registryEntries: RegistryEntry[] = []
// Uuids of the entries above, for the per-output-chunk check in forwardOutput —
// that runs on every byte an agent emits, so it must not scan.
let liveRegistryUuids = new Set<string>()
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

/** Filesystem adapter for discoverSkills, which stays Node-free so the renderer
 * can import withSkills() from the same module. Both calls swallow their errors:
 * an absent ~/.claude/skills or .claude/skills is the ordinary case. */
const skillFs: SkillFs = {
  readdir(dir) {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  },
  readFile(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return ''
    }
  }
}

/** Resolve a new worktree path from the settings template (relative to repo). */
function resolveWorktreePath(repoRoot: string, branch: string): string {
  const tmpl = settings().load().worktreeFolder || '../{repo}-wt-{branch}'
  const sub = expandWorktreeTemplate(tmpl, { repo: basename(repoRoot), branch, now: new Date() })
  return resolve(repoRoot, sub)
}

/**
 * Run a user hook (fire-and-forget) in an interactive login shell. The command
 * can be any shell command, a script path, or an agent invocation (e.g.
 * `agy -p "/setup"`). {worktree}/{branch}/{repo} placeholders are expanded; the
 * same values are also exposed as $CCM_WORKTREE_PATH / $CCM_BRANCH / $CCM_REPO.
 *
 * The shell is `$SHELL -ilc` (interactive + login), NOT `-lc`: version managers
 * like asdf/nvm/rbenv put their shims on PATH from `.zshrc`, which a login-only
 * non-interactive shell never sources. Without `-i`, a hook such as `npm ci`
 * fails with "node: command not found" — the exact reason a hook silently does
 * nothing. (commandExists() relies on the same distinction; see its comment.)
 *
 * Substituted values are SHELL-QUOTED: branch/worktree/repo can contain shell
 * metacharacters (git allows `;` `|` `$()` backticks in branch names), so an
 * unquoted `{branch}` would be a command-injection vector when a hook runs.
 *
 * Failures are surfaced to the renderer (toast) instead of being swallowed — a
 * silently-failing hook is indistinguishable from one that never ran.
 */
function runHook(
  kind: HookFailedEvent['kind'],
  cmd: string,
  cwd: string,
  extraEnv: Record<string, string>
): void {
  if (!cmd || !cmd.trim()) return
  const expanded = cmd
    .replace(/\{worktree\}/g, shellQuote(extraEnv.CCM_WORKTREE_PATH ?? ''))
    .replace(/\{branch\}/g, shellQuote(extraEnv.CCM_BRANCH ?? ''))
    .replace(/\{repo\}/g, shellQuote(extraEnv.CCM_REPO ?? ''))
  const shell = process.env.SHELL || '/bin/zsh'
  const fail = (code: number | null, output: string): void =>
    send(Channels.hookFailed, { kind, command: cmd, code, output: output.trim().slice(-4000) })
  try {
    execFile(
      shell,
      ['-ilc', expanded],
      { cwd, env: { ...process.env, ...extraEnv }, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // An interactive shell prints prompt/plugin noise to stderr even on
        // success; only report when the hook itself exited non-zero.
        if (err) fail((err as { code?: number }).code ?? null, `${stdout}${stderr}`)
      }
    )
  } catch (err) {
    fail(null, err instanceof Error ? err.message : String(err))
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
    durable: control.has(s.id) || undefined,
    waitingFor: waitingReason.get(s.id)
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
  // Key the session name by a stable per-agent id so multiple agents in one
  // worktree get distinct tmux sessions (and reattach to the right one).
  return on ? tmuxSessionName(req.worktreeId, req.durableKey) : undefined
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
    // Interactive login shell (`-ilc`): sources .zshrc, so the agent runs with the
    // SAME PATH + aliases + version-manager shims as the user's real terminal. This
    // matters when `claude` is a shell alias (e.g. `claude --plugin-dir …`) or lives
    // on a `.zshrc`-only PATH — a non-interactive `-lc` shell would launch a bare/
    // different binary and silently drop the user's plugins/skills. `-c <cmd>` means
    // no interactive prompt renders, so the pane still shows the CLI directly.
    // CCM_AGENT_CMD (a trusted env override, used by tests) takes precedence.
    const override = process.env.CCM_AGENT_CMD
    if (override) return { command: shell, args: ['-ilc', override] }
    // Defense-in-depth: the command runs via `$SHELL -ilc`, so a compromised
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
    return { command: shell, args: ['-ilc', agentCmd] }
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

/**
 * Terminate durable (tmux) sessions by name. Best-effort and idempotent: a name
 * that is already gone is not an error. `sync` is used on the quit path, where
 * the app may exit before an async child has a chance to run.
 */
function killTmuxSessions(names: string[], sync = false): void {
  if (names.length === 0) return
  const shell = process.env.SHELL || '/bin/zsh'
  const { command, args } = buildTmuxKill(shell, names)
  try {
    if (sync) execFileSync(command, args, { stdio: 'ignore', timeout: 5000 })
    else execFile(command, args, () => {})
  } catch {
    /* ignore — best-effort teardown, like runHook */
  }
}

// --- Grove MCP bus -----------------------------------------------------------

/** Recent plain-text output per pane, for the `tail` tool. */
const outputBuffers = new Map<string, OutputBuffer>()
/** Launch handles handed to the renderer, mapped to the ticket they stand for.
 * The ticket itself never leaves main: the renderer only ever sees the opaque
 * handle and the config path. */
const mcpPending = new Map<string, string>()
/** Per-session config file, unlinked when the pane goes away. */
const mcpConfigPaths = new Map<string, string>()
let mcpServer: GroveMcpServer | null = null

/** Where per-agent MCP config files live. Overridable so a test run cannot
 * touch — or wipe, see the boot-time clear — a real Grove's live configs. */
function mcpDir(): string {
  return process.env.CCM_MCP_DIR ?? join(app.getPath('userData'), 'mcp')
}

/** Pane id for a target an agent named — its Grove id, or its exact tab title. */
function resolvePaneTarget(target: string): string | undefined {
  if (registry.getSession(target)) return target
  return registry.all().find((s) => s.title === target && ptys.has(s.id))?.id
}

const mcpHost: McpHost = {
  listSessions(callerId) {
    return registry
      .all()
      .filter((s) => ptys.has(s.id))
      .map((s) => ({
        id: s.id,
        title: s.title,
        worktree: s.worktreeId,
        cwd: s.cwd,
        state: s.state,
        waitingFor: waitingReason.get(s.id),
        self: s.id === callerId || undefined
      }))
  },
  tail(target, lines) {
    const id = resolvePaneTarget(target)
    if (!id) return null
    return outputBuffers.get(id)?.tail(lines) ?? []
  },
  sendTo(target, message, callerId) {
    const id = resolvePaneTarget(target)
    if (!id) return false
    // Attribution travels IN the message rather than as a transient UI badge:
    // the recipient agent must know this came from another agent and not from
    // the user (it is not consent for anything), and putting it in the pane's
    // own transcript is also the clearest thing for the person watching.
    const from = callerId ? registry.getSession(callerId) : undefined
    const label = from ? `${from.title} @ ${basename(from.worktreeId)}` : 'another Grove pane'
    writeToPane(id, `[grove] from ${label}: ${message}\r`)
    return true
  }
}

/** Deliver input to a pane, honouring the tmux control-mode path. */
function writeToPane(id: string, data: string): void {
  const c = control.get(id)
  if (c) {
    if (data.length) ptys.get(id)?.write(`send-keys -t ${c.name} -H ${toSendKeysHex(data)}\n`)
    return
  }
  ptys.get(id)?.write(data)
}

/**
 * Mint one agent's MCP credentials and write its config file. Returns null when
 * the server never bound — Grove then launches the agent with no flag at all
 * rather than failing the launch over an optional capability.
 */
function mcpLaunchConfig(): { handle: string; configPath: string } | null {
  if (!mcpServer || mcpServer.port === 0) return null
  try {
    const dir = mcpDir()
    mkdirSync(dir, { recursive: true })
    const handle = randomUUID()
    const ticket = mcpServer.mintTicket()
    const configPath = join(dir, `${handle}.json`)
    // 0600, and a file rather than an inline --mcp-config JSON string: a command
    // line is world-readable through `ps`.
    writeFileSync(configPath, JSON.stringify(buildMcpConfig(mcpServer.port, ticket)), {
      mode: 0o600
    })
    mcpPending.set(handle, ticket)
    return { handle, configPath }
  } catch {
    return null
  }
}

/** Drop a pane's MCP credentials and its config file. */
function forgetMcp(groveId: string): void {
  mcpServer?.revokeSession(groveId)
  const path = mcpConfigPaths.get(groveId)
  if (path) rmSync(path, { force: true })
  mcpConfigPaths.delete(groveId)
  outputBuffers.delete(groveId)
}

// --- Claude session registry -------------------------------------------------

function claudeSessionsDir(): string {
  return process.env.CCM_CLAUDE_SESSIONS ?? join(homedir(), '.claude', 'sessions')
}

/** Is that pid still around? A crashed CLI leaves its registry file behind, and
 * a phantom record would otherwise pin a tab to a state nothing can move. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Every live record in Claude's registry. Unreadable or half-written files are
 * skipped for this tick rather than failing the sweep — the directory belongs to
 * another program, which rewrites it whenever it likes. */
function readClaudeRegistry(): RegistryEntry[] {
  const dir = claudeSessionsDir()
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: RegistryEntry[] = []
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue
    try {
      const entry = parseRegistryEntry(JSON.parse(readFileSync(join(dir, name), 'utf8')))
      if (entry && pidAlive(entry.pid)) out.push(entry)
    } catch {
      /* skip this file this tick */
    }
  }
  return out
}

/** Does this Grove session currently have a live registry record backing it?
 * When it doesn't — a non-claude agent, or a resume chain that fell through to a
 * bare `claude` with a uuid we never learned — output scraping stays in charge. */
function registryBacked(groveId: string): boolean {
  const uuid = agentSessionIds.get(groveId)
  return uuid !== undefined && liveRegistryUuids.has(uuid)
}

/** Drop a torn-down session's registry bookkeeping. Called wherever a session
 * stops existing, so a recycled Grove id can never inherit a stale reason. */
function forgetRegistryJoin(groveId: string): void {
  agentSessionIds.delete(groveId)
  waitingReason.delete(groveId)
  forgetMcp(groveId)
}

/** Push registry status onto the Grove sessions it backs. The decision of what
 * changed lives in core/claudeRegistry; this is the plumbing around it. */
function applyRegistry(): void {
  const current = new Map(
    [...agentSessionIds.keys()].flatMap((groveId) => {
      const record = registry.getSession(groveId)
      if (!record || !ptys.has(groveId)) return []
      return [[groveId, { state: record.state, waitingFor: waitingReason.get(groveId) }] as const]
    })
  )
  for (const u of registryUpdates(registryEntries, agentSessionIds, current)) {
    if (u.waitingFor) waitingReason.set(u.groveId, u.waitingFor)
    else waitingReason.delete(u.groveId)
    if (u.reasonOnly) {
      // setState early-returns on an unchanged state, which would swallow the
      // new reason — emit it directly.
      send(Channels.sessionStateChange, {
        id: u.groveId,
        state: u.state,
        waitingFor: u.waitingFor
      })
      continue
    }
    const record = registry.getSession(u.groveId)
    if (record) record.state = u.state
    // onStateChange attaches the reason and emits — see createSession.
    ptys.get(u.groveId)?.setState(u.state)
  }
  if (process.env.CCM_DEBUG_REGISTRY)
    console.log(`[registry] ${registryEntries.length} live, ${agentSessionIds.size} joined`)
  // Pushed, not polled — main already watches the directory, so the sidebar's
  // Elsewhere list has no reason to ask. Only when it actually CHANGED, though:
  // every claude on the machine rewrites its file on each busy/idle flip, and a
  // renderer notify re-renders the whole tree.
  const next = JSON.stringify(fleetSessions())
  if (next !== lastFleetJson) {
    lastFleetJson = next
    send(Channels.fleetChange, { sessions: JSON.parse(next) })
  }
}
let lastFleetJson = ''

/** Claude sessions on this machine that are not one of Grove's own panes. */
function fleetSessions(): RegistryEntry[] {
  return unjoinedEntries(registryEntries, new Set(agentSessionIds.values()))
}

/** Stop a background session. `claude stop` takes the short job id; the id rides
 * as a positional arg so it can never be read as shell (same guard as
 * killTmuxSessions). */
function stopFleetSession(jobId: string): void {
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    execFile(shell, ['-lc', 'claude stop "$1"', '--', jobId], () => {})
  } catch {
    /* best-effort — the watcher reports the real outcome either way */
  }
}

/**
 * Watch Claude's registry directory. The files are rewritten on each status
 * TRANSITION rather than on a heartbeat, so watching is sufficient and polling
 * would just burn wakeups. One transition can rewrite a file more than once, so
 * the reread is debounced.
 *
 * The directory may not exist yet (claude never run on this machine); retry on a
 * slow timer so the very first agent Grove launches doesn't need an app restart
 * before its state goes live.
 */
function startClaudeRegistryWatch(): void {
  let debounce: NodeJS.Timeout | null = null
  const refresh = (): void => {
    registryEntries = readClaudeRegistry()
    liveRegistryUuids = new Set(registryEntries.map((e) => e.sessionId))
    applyRegistry()
  }
  const attach = (): void => {
    refresh()
    try {
      watch(claudeSessionsDir(), () => {
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(refresh, 150)
      })
    } catch {
      setTimeout(attach, 30_000).unref?.()
    }
  }
  attach()
}

function createSession(req: CreateSessionRequest): SessionSnapshot {
  // A user-supplied file path (viewer panes) may be pasted relative, with `~`, or
  // quoted — resolve it against the worktree cwd now so fileRead/IDE-open (which
  // run in the main process, NOT cwd'd into the worktree) get an absolute path.
  // A `web` viewer carries a URL in filePath — leave it untouched; only local
  // file paths are resolved against the worktree.
  const filePath =
    req.filePath && req.cwd && req.viewerKind !== 'web'
      ? resolveUserPath(req.cwd, req.filePath)
      : req.filePath
  // Registry enforces the single-agent-per-worktree invariant (may throw).
  const record = registry.addSession({
    worktreeId: req.worktreeId,
    kind: req.kind,
    title: req.title,
    icon: req.icon,
    cwd: req.cwd,
    filePath,
    viewerKind: req.viewerKind,
    // Non-pty panes (viewer/diff) are inert from the start — no 'starting' state.
    state: req.kind === 'viewer' || req.kind === 'diff' ? 'idle' : undefined
  })

  // Viewer/diff panes render content, not a pty — skip the whole spawn path.
  // sessionInput/resize/kill all key off the `ptys` map, so they no-op safely.
  if (req.kind === 'viewer' || req.kind === 'diff') return snapshot(record)

  const agent = req.agent ?? (req.kind === 'agent' ? 'claude' : '')
  // Join key into Claude's session registry. Recorded before the spawn so the
  // very first registry sweep after startup already sees this session.
  if (req.agentSessionId) agentSessionIds.set(record.id, req.agentSessionId)
  // Bind the credentials minted for this launch to the pane they ended up
  // starting, so the MCP server can tell who is calling it.
  const ticket = req.mcpHandle ? mcpPending.get(req.mcpHandle) : undefined
  if (ticket && req.mcpHandle) {
    mcpServer?.bindTicket(ticket, record.id)
    mcpPending.delete(req.mcpHandle)
    if (req.mcpConfigPath) mcpConfigPaths.set(record.id, req.mcpConfigPath)
  }
  outputBuffers.set(record.id, new OutputBuffer())
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
    outputBuffers.get(record.id)?.append(data)
    // Claude's registry is authoritative wherever we can join to it; scraping
    // the byte stream is the fallback for everything else. Checked per chunk (not
    // once at spawn) so a session whose registry record disappears mid-flight
    // degrades back to detection instead of freezing on its last known state.
    if (agent && !registryBacked(record.id)) {
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
        forgetRegistryJoin(record.id)
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
    send(Channels.sessionStateChange, {
      id: record.id,
      state,
      waitingFor: waitingReason.get(record.id)
    })
  })
  pty.onExit(({ exitCode, signal }) => {
    record.state = 'exited'
    send(Channels.sessionExit, { id: record.id, exitCode, signal })
    ptys.delete(record.id)
    control.delete(record.id)
    forgetRegistryJoin(record.id)
  })

  ptys.set(record.id, pty)
  try {
    pty.start()
  } catch (err) {
    // Spawn failed (e.g. shell not found) — roll back the registry record.
    ptys.delete(record.id)
    control.delete(record.id)
    forgetRegistryJoin(record.id)
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
  ipcMain.handle(Channels.skillsAvailable, (_e, repoRoot?: string) =>
    discoverSkills(skillFs, { home: homedir(), repoRoot })
  )
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
      runHook('create', store().get(repoRoot)?.hookCreate ?? '', info.path, {
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
  ipcMain.handle(Channels.urlEmbeddable, async (_e: IpcMainInvokeEvent, url: string) => {
    if (!/^https?:\/\//i.test(url)) return false
    try {
      // Read just the headers (cancel the body) to learn if the site refuses
      // framing. Optimistic on any error — prefer embedding; a genuinely broken
      // load just shows the site's own error in the pane.
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(5000) })
      const ok = parseFrameability(
        res.headers.get('x-frame-options'),
        res.headers.get('content-security-policy')
      )
      await res.body?.cancel().catch(() => {})
      return ok
    } catch {
      return true
    }
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
      runHook('remove', store().get(req.repoRoot)?.hookRemove ?? '', req.path, {
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
    let size: number
    try {
      ;({ size } = await statAsync(filePath))
    } catch (err) {
      // Surface a clear, path-naming message (the viewer pane shows err.message
      // verbatim) instead of a bare ENOENT — a clicked link that resolved to the
      // wrong place is the most common failure, and the path is the answer.
      throw new Error(describeViewerReadError(err, filePath))
    }
    if (size > MAX) {
      throw new Error(`File too large to preview (${(size / 1048576).toFixed(1)} MB; limit 5 MB)`)
    }
    try {
      return await readFileAsync(filePath, 'utf8')
    } catch (err) {
      throw new Error(describeViewerReadError(err, filePath))
    }
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
  ipcMain.handle(Channels.mcpLaunch, () => mcpLaunchConfig())
  ipcMain.handle(Channels.fleetList, () => fleetSessions())
  ipcMain.on(Channels.fleetStop, (_e, jobId: string) => stopFleetSession(jobId))
  ipcMain.on(Channels.sessionKill, (_e, id: string, detach?: boolean) => {
    // For a control session, killing the pty only exits the -CC client — the tmux
    // session and the agent inside it keep running. Durability is meant to survive
    // a Grove RESTART, not a deliberate close: without the kill-session below,
    // every closed tab left a permanently-running agent behind (and, in bulk, a
    // machine that won't shut down). `detach` is the explicit opt-out — the tab
    // menu's "Detach (keep running)" — which keeps the old behaviour.
    const c = control.get(id)
    ptys.get(id)?.kill()
    if (c && !detach) killTmuxSessions([c.name])
    control.delete(id)
    forgetRegistryJoin(id)
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
      contextIsolation: true,
      // Occluded windows normally get their renderer throttled and GPU
      // resources reclaimed, which blanks the xterm WebGL canvas until
      // something forces a repaint. The renderer repaints on focus/visibility
      // anyway (Store.repaintAllPanes), but agents keep streaming while Grove
      // is in the background, so throttled timers would also stall the pty
      // read loop and state detection.
      backgroundThrottling: false
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

/**
 * Serve a local file to the HTML viewer frame. The URL pathname IS the file's
 * absolute path (`grove-html://open/Users/me/report.html`), so relative assets
 * the report references (`./style.css`, `img/x.png`) resolve against the same
 * scheme and load too. Same 5 MB ceiling as the fileRead IPC.
 */
async function serveHtmlViewer(request: Request): Promise<Response> {
  const MAX = 5 * 1024 * 1024
  // A plain-text error body renders as a blank frame; a tiny HTML page makes the
  // failure visible in the viewer pane (mirrors the markdown viewer's red error).
  const errorPage = (msg: string, status: number): Response =>
    new Response(
      `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;color:#b00;padding:16px">Could not open file: ${msg
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')}</body>`,
      { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
    )
  let filePath: string
  try {
    filePath = htmlViewerPath(request.url)
  } catch {
    return errorPage('bad request', 400)
  }
  try {
    const { size } = await statAsync(filePath)
    if (size > MAX)
      return errorPage(
        `File too large to preview (${(size / 1048576).toFixed(1)} MB; limit 5 MB)`,
        413
      )
    const buf = await readFileAsync(filePath)
    return new Response(buf, { headers: { 'content-type': viewerMime(filePath) } })
  } catch (err) {
    return errorPage(describeViewerReadError(err, filePath), 404)
  }
}

app.whenReady().then(() => {
  migrateUserData()
  protocol.handle(HTML_VIEWER_SCHEME, serveHtmlViewer)
  registerIpc()
  startClaudeRegistryWatch()
  // Config files are per-launch and only useful while their pane lives; a crash
  // leaves them behind, so clear the directory before minting any new ones.
  rmSync(mcpDir(), { recursive: true, force: true })
  mcpServer = new GroveMcpServer(mcpHost)
  void mcpServer.start().then((port) => {
    if (process.env.CCM_DEBUG_REGISTRY) console.log(`[mcp] ${port ? `:${port}` : 'not started'}`)
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quitting with durable agents still attached: their tmux sessions would outlive
// Grove entirely (that's the point of durable mode — reattach on next launch),
// but silently leaving N agents running is how the machine ends up unable to shut
// down. Ask once, and let the user choose. Answered synchronously because the
// decision has to be made before the app tears down.
let quitAnswered = false
app.on('before-quit', (e) => {
  const names = [...control.values()].map((c) => c.name)
  if (quitAnswered || names.length === 0) return
  // No human to answer under automation — terminate rather than block the quit
  // on a modal nobody can click (and rather than leak agents out of a test run).
  if (process.env.CCM_NO_QUIT_PROMPT) {
    quitAnswered = true
    killTmuxSessions(names, true)
    return
  }
  const n = names.length
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Terminate all', 'Keep running', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Grove',
    message: `${n} durable agent session${n === 1 ? '' : 's'} still running`,
    detail:
      'Durable agents keep running in the background after Grove quits, and reattach ' +
      'the next time you launch it. Terminate them now, or leave them running?'
  })
  if (choice === 2) {
    e.preventDefault()
    return
  }
  quitAnswered = true
  if (choice === 0) killTmuxSessions(names, true)
})

app.on('window-all-closed', () => {
  mcpServer?.close()
  for (const p of ptys.values()) p.kill()
  if (process.platform !== 'darwin') app.quit()
})

// Compile-time assurance the handlers cover the renderer surface.
export type _ApiContract = RendererApi
