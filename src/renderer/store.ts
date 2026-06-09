import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SessionKind, SessionState } from '../core/types'
import type { SessionSnapshot } from '../main/ipc'
import type { SessionDescriptor } from '../core/layoutStore'
import {
  DEFAULT_SETTINGS,
  SHELL_ICON,
  type AppSettings,
  type AgentDef,
  type ResolvedAgent
} from '../core/settings'

export interface WorktreeView {
  id: string // = path
  path: string
  branch: string
  primary: boolean
}
export interface ProjectView {
  repoRoot: string // = id
  name: string
  expanded: boolean
  loaded: boolean
  worktrees: Map<string, WorktreeView>
}
export interface WtStatus {
  dirty: number
  ahead: number
  behind: number
}
/** A modal the sidebar wants to show. */
export type DialogState =
  | { kind: 'closeProject'; repoRoot: string; name: string }
  | { kind: 'createWorktree'; repoRoot: string; projectName: string }
  | { kind: 'removeWorktree'; repoRoot: string; wtId: string; branch: string; folder: string }
interface PaneRef {
  term: Terminal
  fit: FitAddon
}

const ANSI_RE = /\[[0-9;?]*[A-Za-z]|\][^]*|[()][AB0]/g
function lastNonEmptyLine(data: string): string | null {
  const lines = data
    .replace(ANSI_RE, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length ? lines[lines.length - 1] : null
}

/**
 * Single source of truth for the renderer. Holds all UI state + actions + the
 * pty/IPC wiring. React subscribes via `useSyncExternalStore(subscribe,
 * getVersion)` and reads fields directly; every mutating action calls notify().
 * Terminal instances are created by the React <Pane> but registered here so the
 * data stream and fit/resize can reach them imperatively.
 */
class Store {
  projects = new Map<string, ProjectView>()
  sessions = new Map<string, SessionSnapshot>()
  panes = new Map<string, PaneRef>()
  pending = new Set<string>()
  splitMode = new Map<string, boolean>()
  lastLine = new Map<string, string>()
  wtStatus = new Map<string, WtStatus>()
  activeProjectId: string | null = null
  activeWorktreeId: string | null = null
  focusedSessionId: string | null = null
  colFr: number[] = []
  rowFr: number[] = []
  settings: AppSettings = { ...DEFAULT_SETTINGS }
  settingsOpen = false
  availableAgents: ResolvedAgent[] = []
  dialog: DialogState | null = null

  private savedLayout: SessionDescriptor[] = []
  private restoredProjects = new Set<string>()
  private restoring = false
  private repoRoot = ''
  private prevVisible: string[] = []
  private lineRefreshScheduled = false

  private version = 0
  private listeners = new Set<() => void>()
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  getVersion = (): number => this.version
  private notify(): void {
    this.version++
    this.listeners.forEach((l) => l())
  }

  // --- selectors ---------------------------------------------------------
  sessionsOf(worktreeId: string): SessionSnapshot[] {
    return [...this.sessions.values()].filter((s) => s.worktreeId === worktreeId)
  }
  activeProject(): ProjectView | undefined {
    return this.activeProjectId ? this.projects.get(this.activeProjectId) : undefined
  }
  /** Representative latest output line for a worktree card (prefers the agent). */
  worktreeLastLine(wtId: string): string {
    const ss = this.sessionsOf(wtId)
    const pick = ss.find((s) => s.kind === 'agent') ?? ss[0]
    return pick ? (this.lastLine.get(pick.id) ?? '') : ''
  }
  worktreePending(wtId: string): boolean {
    return this.sessionsOf(wtId).some((s) => this.pending.has(s.id))
  }
  /** Worst session state in a worktree, for the card's status dot. */
  worktreeState(wtId: string): SessionState | 'none' {
    const ss = this.sessionsOf(wtId)
    if (ss.some((s) => this.pending.has(s.id))) return 'waiting'
    if (ss.some((s) => s.state === 'busy')) return 'busy'
    if (ss.some((s) => s.state === 'idle')) return 'idle'
    return ss.length ? ss[0].state : 'none'
  }
  /** Sessions whose panes are shown: all (split) or just the focused one. */
  visibleSessions(): string[] {
    if (!this.activeWorktreeId) return []
    const all = this.sessionsOf(this.activeWorktreeId).map((s) => s.id)
    if (this.splitMode.get(this.activeWorktreeId)) return all
    if (this.focusedSessionId && all.includes(this.focusedSessionId)) return [this.focusedSessionId]
    return all.slice(0, 1)
  }
  /** Ensure colFr/rowFr match the grid shape; returns {cols, rows, visible}. */
  computeGrid(): { cols: number; rows: number; visible: string[] } {
    const visible = this.visibleSessions()
    const n = Math.max(visible.length, 1)
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    if (this.colFr.length !== cols) this.colFr = Array(cols).fill(1)
    if (this.rowFr.length !== rows) this.rowFr = Array(rows).fill(1)
    return { cols, rows, visible }
  }

  // --- terminal registration (called by <Pane>) --------------------------
  registerPane(id: string, term: Terminal, fit: FitAddon): void {
    this.panes.set(id, { term, fit })
  }
  unregisterPane(id: string): void {
    this.panes.get(id)?.term.dispose()
    this.panes.delete(id)
  }

  /** Fit + resize visible panes; nudge newly-shown panes so TUIs repaint. */
  fitVisible(): void {
    const visible = this.visibleSessions()
    const newlyShown = visible.filter((id) => !this.prevVisible.includes(id))
    this.prevVisible = visible.slice()
    requestAnimationFrame(() => {
      for (const id of visible) {
        const pane = this.panes.get(id)
        if (!pane) continue
        pane.fit.fit()
        const { cols, rows } = pane.term
        window.api.sessionResize(id, cols, rows)
        if (newlyShown.includes(id) && rows > 1) {
          pane.term.resize(cols, rows - 1)
          window.api.sessionResize(id, cols, rows - 1)
          requestAnimationFrame(() => {
            pane.term.resize(cols, rows)
            window.api.sessionResize(id, cols, rows)
          })
        }
      }
    })
  }

  // --- persistence -------------------------------------------------------
  private currentDescriptors(): SessionDescriptor[] {
    const out: SessionDescriptor[] = []
    for (const project of this.projects.values())
      for (const wt of project.worktrees.values())
        for (const s of this.sessionsOf(wt.id))
          out.push({
            repoRoot: project.repoRoot,
            worktreePath: wt.path,
            kind: s.kind,
            title: s.title,
            icon: s.icon
          })
    return out
  }
  private persistLayout(): void {
    if (this.restoring) return
    const keep = this.savedLayout.filter((d) => !this.restoredProjects.has(d.repoRoot))
    const merged = [...keep, ...this.currentDescriptors()]
    this.savedLayout = merged
    window.api.layoutSave(merged)
  }
  private async restoreProject(project: ProjectView): Promise<void> {
    if (this.restoredProjects.has(project.repoRoot)) return
    this.restoredProjects.add(project.repoRoot)
    const toRestore = this.savedLayout.filter((d) => d.repoRoot === project.repoRoot)
    if (toRestore.length === 0) return
    this.restoring = true
    for (const d of toRestore) {
      const wt = [...project.worktrees.values()].find((w) => w.path === d.worktreePath)
      if (!wt) continue
      // Recover which agent this was from its icon so codex/gemini restore as
      // themselves (not the default), and keep the saved/renamed title.
      const agentDef =
        d.kind === 'agent' ? this.availableAgents.find((a) => a.icon === d.icon) : undefined
      await this.addSession(wt.id, d.kind, agentDef, d.title)
    }
    this.restoring = false
    this.persistLayout()
  }

  // --- projects ----------------------------------------------------------
  private async loadWorktrees(project: ProjectView): Promise<void> {
    project.worktrees.clear()
    try {
      const list = await window.api.worktreeList(project.repoRoot)
      list.forEach((w, i) =>
        project.worktrees.set(w.path, {
          id: w.path,
          path: w.path,
          branch: w.branch,
          primary: i === 0 || w.path === project.repoRoot
        })
      )
    } catch {
      /* not a git repo */
    }
    project.loaded = true
    for (const wt of project.worktrees.values()) {
      window.api
        .worktreeStatus(wt.path)
        .then((s) => {
          this.wtStatus.set(wt.id, s)
          this.notify()
        })
        .catch(() => {})
    }
  }
  private upsertProject(repoRoot: string, name: string): ProjectView {
    let p = this.projects.get(repoRoot)
    if (!p) {
      p = { repoRoot, name, expanded: false, loaded: false, worktrees: new Map() }
      this.projects.set(repoRoot, p)
    }
    return p
  }
  async openProject(): Promise<void> {
    try {
      const entry = await window.api.projectOpenDialog()
      if (!entry) return
      this.upsertProject(entry.repoRoot, entry.name)
      await this.setActiveProject(entry.repoRoot)
    } catch (err) {
      this.toast(errMsg(err))
    }
  }
  toggleProjectExpand(repoRoot: string): void {
    const p = this.projects.get(repoRoot)
    if (!p) return
    p.expanded = !p.expanded
    this.notify()
  }
  async setActiveProject(repoRoot: string): Promise<void> {
    const p = this.projects.get(repoRoot)
    if (!p) return
    this.activeProjectId = repoRoot
    p.expanded = true // select expands this one; never collapses others
    if (!p.loaded) await this.loadWorktrees(p)
    await this.restoreProject(p)
    this.activeWorktreeId = p.worktrees.keys().next().value ?? null
    this.syncFocus()
    this.notify()
  }
  async removeProject(repoRoot: string): Promise<void> {
    for (const wt of this.projects.get(repoRoot)?.worktrees.values() ?? [])
      for (const s of this.sessionsOf(wt.id)) this.closeSession(s.id, true)
    await window.api.projectRemove(repoRoot)
    this.projects.delete(repoRoot)
    this.savedLayout = this.savedLayout.filter((d) => d.repoRoot !== repoRoot)
    this.restoredProjects.add(repoRoot)
    if (this.activeProjectId === repoRoot) {
      this.activeProjectId = this.projects.keys().next().value ?? null
      this.activeWorktreeId = this.activeProject()?.worktrees.keys().next().value ?? null
    }
    this.persistLayout()
    this.notify()
  }

  // --- worktrees ---------------------------------------------------------
  async createWorktree(project: ProjectView, branch: string): Promise<void> {
    try {
      // Path is computed by main from the worktreeFolder setting (+ runs hooks).
      const info = await window.api.worktreeCreate(project.repoRoot, { branch, newBranch: true })
      project.worktrees.set(info.path, {
        id: info.path,
        path: info.path,
        branch: info.branch || branch,
        primary: false
      })
      this.activeProjectId = project.repoRoot
      this.activeWorktreeId = info.path
      this.syncFocus()
    } catch (err) {
      this.toast(errMsg(err))
    }
    this.notify()
  }
  async removeWorktree(project: ProjectView, wtId: string, deleteBranch = false): Promise<void> {
    const wt = project.worktrees.get(wtId)
    if (!wt || wt.primary) return
    for (const s of this.sessionsOf(wtId)) this.closeSession(s.id, true)
    try {
      await window.api.worktreeRemove({
        repoRoot: project.repoRoot,
        path: wt.path,
        force: true,
        deleteBranch: deleteBranch ? wt.branch : undefined
      })
    } catch (err) {
      this.toast(errMsg(err))
    }
    project.worktrees.delete(wtId)
    if (this.activeWorktreeId === wtId)
      this.activeWorktreeId = project.worktrees.keys().next().value ?? null
    this.persistLayout()
    this.notify()
  }
  async selectWorktree(projectId: string, wtId: string): Promise<void> {
    this.activeProjectId = projectId
    this.activeWorktreeId = wtId
    const p = this.projects.get(projectId)
    if (p) await this.restoreProject(p) // respawn this project's sessions on first select
    this.syncFocus()
    this.notify()
  }
  switchWorktree(index: number): void {
    const p = this.activeProject()
    if (!p) return
    const wt = [...p.worktrees.values()][index]
    if (wt) void this.selectWorktree(p.repoRoot, wt.id)
  }
  async switchProject(index: number): Promise<void> {
    const p = [...this.projects.values()][index]
    if (p) await this.setActiveProject(p.repoRoot)
  }

  // --- sessions ----------------------------------------------------------
  async addSession(
    worktreeId: string,
    kind: SessionKind,
    agentDef?: AgentDef,
    titleOverride?: string
  ): Promise<void> {
    const wt = this.activeProject()?.worktrees.get(worktreeId)
    if (!wt) return
    const isAgent = kind === 'agent'
    const icon = isAgent ? (agentDef?.icon ?? '★') : SHELL_ICON
    const baseName = isAgent ? (agentDef?.name?.toLowerCase() ?? 'agent') : 'shell'
    const command = isAgent ? (agentDef?.command ?? 'claude') : 'shell'
    const detect = isAgent ? (agentDef?.id ?? 'claude') : undefined
    const n = this.sessionsOf(worktreeId).filter((x) => x.icon === icon).length
    const title = titleOverride ?? (n === 0 ? baseName : `${baseName} ${n + 1}`)
    // Estimate columns so the shell's first prompt renders at ~the right width
    // (avoids reflow garbage). Rows are left to FitAddon to avoid over-counting
    // and clipping the bottom line.
    const root = document.getElementById('panes')
    const cols = root ? Math.max(20, Math.floor(root.clientWidth / 7.8)) : 80
    try {
      const snap = await window.api.sessionCreate({
        worktreeId,
        kind,
        command,
        agent: detect,
        cwd: wt.path,
        title,
        icon,
        cols
      })
      this.sessions.set(snap.id, snap)
      this.activeWorktreeId = worktreeId
      this.focusedSessionId = snap.id
      this.persistLayout()
    } catch (err) {
      this.toast(errMsg(err))
    }
    this.notify()
  }
  renameSession(id: string, title: string): void {
    const s = this.sessions.get(id)
    const next = title.trim()
    if (!s || !next || s.title === next) return
    this.sessions.set(id, { ...s, title: next })
    this.persistLayout()
    this.notify()
  }
  closeSession(id: string, quiet = false): void {
    window.api.sessionKill(id)
    const wtId = this.sessions.get(id)?.worktreeId
    this.sessions.delete(id)
    this.pending.delete(id)
    this.lastLine.delete(id)
    // If the closed session was focused, move focus to a sibling in its worktree.
    if (this.focusedSessionId === id) {
      this.focusedSessionId = wtId ? (this.sessionsOf(wtId)[0]?.id ?? null) : null
    }
    if (!quiet) {
      this.persistLayout()
      this.notify()
    }
  }
  focusSession(id: string): void {
    this.focusedSessionId = id
    this.pending.delete(id)
    this.notify()
    this.panes.get(id)?.term.focus()
  }
  /** Cycle focus among the active worktree's sessions (delta +1 / -1). */
  cycleSession(delta: number): void {
    if (!this.activeWorktreeId) return
    const list = this.sessionsOf(this.activeWorktreeId)
    if (list.length < 2) return
    const i = list.findIndex((s) => s.id === this.focusedSessionId)
    const next = list[(((i < 0 ? 0 : i) + delta) % list.length + list.length) % list.length]
    if (next) this.focusSession(next.id)
  }
  closeFocused(): void {
    if (this.focusedSessionId) this.closeSession(this.focusedSessionId)
  }
  newShellInActive(): void {
    if (this.activeWorktreeId) void this.addSession(this.activeWorktreeId, 'shell')
  }
  private syncFocus(): void {
    const visible = new Set(
      this.activeWorktreeId ? this.sessionsOf(this.activeWorktreeId).map((s) => s.id) : []
    )
    if (this.focusedSessionId && !visible.has(this.focusedSessionId)) this.focusedSessionId = null
    if (!this.focusedSessionId && visible.size) this.focusedSessionId = [...visible][0]
  }

  // --- split / notifications --------------------------------------------
  toggleSplit(): void {
    if (!this.activeWorktreeId) return
    this.splitMode.set(this.activeWorktreeId, !this.splitMode.get(this.activeWorktreeId))
    this.notify()
  }
  isSplit(): boolean {
    return this.activeWorktreeId ? !!this.splitMode.get(this.activeWorktreeId) : false
  }
  setFractions(col: number[], row: number[]): void {
    this.colFr = col
    this.rowFr = row
    this.notify()
  }
  jumpToPending(): void {
    const ids = [...this.pending]
    if (!ids.length) return
    const id = ids[ids.length - 1]
    const s = this.sessions.get(id)
    if (!s) {
      this.pending.delete(id)
      return
    }
    for (const p of this.projects.values())
      for (const wt of p.worktrees.values())
        if (wt.id === s.worktreeId) {
          this.activeProjectId = p.repoRoot
          p.expanded = true
          this.activeWorktreeId = wt.id
        }
    this.focusSession(id)
  }

  // --- dialogs -----------------------------------------------------------
  openDialog(d: DialogState): void {
    this.dialog = d
    this.notify()
  }
  closeDialog(): void {
    this.dialog = null
    this.notify()
  }

  // --- settings / appearance ---------------------------------------------
  openSettings(open: boolean): void {
    this.settingsOpen = open
    this.notify()
    // Re-check which agent commands are installed when opening/closing settings
    // (cheap: commandExists is cached per command in main).
    void window.api
      .agentsAvailable()
      .then((a) => {
        this.availableAgents = a
        this.notify()
      })
      .catch(() => {})
  }
  toggleSidebar(): void {
    void this.updateSettings({ sidebarCollapsed: !this.settings.sidebarCollapsed })
  }
  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    this.settings = await window.api.settingsSave(patch)
    this.applyAppearance()
    this.notify()
  }
  /**
   * Apply background colour / transparency. Only sets CSS variables — terminals
   * are transparent and sit on the pane background, so we never touch live
   * Terminal instances (which could blank the canvas renderer).
   */
  applyAppearance(): void {
    const s = this.settings
    const root = document.documentElement
    root.style.setProperty('--bg', s.background)
    if (s.transparent) {
      document.body.style.background = 'transparent'
      root.style.setProperty('--pane-bg', hexToRgba(s.background, s.opacity))
      root.style.setProperty('--panel', hexToRgba(s.background, Math.min(1, s.opacity + 0.12)))
      root.style.setProperty('--panel-2', hexToRgba(s.background, Math.min(1, s.opacity + 0.2)))
    } else {
      document.body.style.background = s.background
      root.style.setProperty('--pane-bg', s.background)
      root.style.setProperty('--panel', '#232329')
      root.style.setProperty('--panel-2', '#2c2c33')
    }
  }

  // --- toast (kept imperative; tiny + transient) -------------------------
  toast(message: string): void {
    const node = document.createElement('div')
    node.className = 'toast'
    node.textContent = message
    document.body.appendChild(node)
    setTimeout(() => node.remove(), 4000)
  }

  // --- bootstrap ---------------------------------------------------------
  wireEvents(): void {
    window.api.onSessionData(({ id, data }) => {
      this.panes.get(id)?.term.write(data)
      const line = lastNonEmptyLine(data)
      if (line) {
        this.lastLine.set(id, line)
        if (!this.lineRefreshScheduled) {
          this.lineRefreshScheduled = true
          setTimeout(() => {
            this.lineRefreshScheduled = false
            this.notify()
          }, 600)
        }
      }
    })
    window.api.onSessionState(({ id, state }) => {
      const s = this.sessions.get(id)
      if (!s) return
      s.state = state
      if ((state as SessionState) === 'waiting' && id !== this.focusedSessionId) {
        this.pending.add(id)
        this.toast(`${s.title} needs your attention`)
      }
      this.notify()
    })
    window.api.onSessionExit(({ id }) => {
      // The pty ended (shell/agent exited) — auto-close its tab/pane.
      if (this.sessions.has(id)) this.closeSession(id)
    })
  }

  async init(): Promise<void> {
    await document.fonts.load('13px "MesloLGS NF"').catch(() => {})
    await document.fonts.load('700 13px "MesloLGS NF"').catch(() => {})
    this.settings = await window.api.settingsLoad()
    this.applyAppearance()
    this.availableAgents = await window.api.agentsAvailable().catch(() => [])
    this.wireEvents()
    this.savedLayout = await window.api.layoutLoad()
    const recent = await window.api.projectListRecent()
    for (const p of recent) this.upsertProject(p.repoRoot, p.name)
    this.repoRoot = await window.api.repoRoot()
    try {
      const entry = await window.api.projectAdd(this.repoRoot)
      this.upsertProject(entry.repoRoot, entry.name)
    } catch {
      /* launched dir not a git repo */
    }
    // Load every project's worktrees so all cards render in the flat sidebar.
    for (const p of this.projects.values()) await this.loadWorktrees(p)
    const first = this.projects.keys().next().value as string | undefined
    if (first) await this.setActiveProject(first)
    else this.notify()
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return hex
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function errMsg(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(/^Error: Error invoking remote method '[^']*':\s*/, '')
    .replace(/^\w*Error:\s*/, '')
}

export const store = new Store()
