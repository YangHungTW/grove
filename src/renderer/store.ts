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
  hookCreate?: string
  hookRemove?: string
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
  | { kind: 'projectSettings'; repoRoot: string; name: string }
  | { kind: 'renameSession'; id: string; title: string }
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
  // VS Code-style editor groups, per worktree. 1 group = single; 2 = left|right.
  // Each group is an ordered list of session ids + its active id.
  groupsByWt = new Map<string, { ids: string[]; active: string }[]>()
  focusedGroupByWt = new Map<string, number>()
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
  /** Editor groups for a worktree, reconciled with its live sessions. */
  groupsOf(wtId: string): { ids: string[]; active: string }[] {
    const all = this.sessionsOf(wtId).map((s) => s.id)
    let groups = this.groupsByWt.get(wtId)
    if (!groups || groups.length === 0) {
      groups = [{ ids: [...all], active: all[0] ?? '' }]
    } else {
      // Add brand-new sessions to group 0; drop dead ids; fix actives.
      const known = new Set(groups.flatMap((g) => g.ids))
      for (const id of all) if (!known.has(id)) groups[0].ids.push(id)
      for (const g of groups) g.ids = g.ids.filter((id) => all.includes(id))
      // Collapse an emptied second group; if group 0 emptied, pull the other up.
      groups = groups.filter((g, i) => i === 0 || g.ids.length > 0)
      if (groups.length > 1 && groups[0].ids.length === 0) groups = [groups[1]]
      for (const g of groups) if (!g.ids.includes(g.active)) g.active = g.ids[g.ids.length - 1] ?? ''
    }
    this.groupsByWt.set(wtId, groups)
    return groups
  }
  focusedGroup(wtId: string): number {
    const n = this.groupsOf(wtId).length
    return Math.min(this.focusedGroupByWt.get(wtId) ?? 0, n - 1)
  }
  /** The visible panes (active session of each group), in column order. */
  visiblePanes(): { id: string; group: number }[] {
    if (!this.activeWorktreeId) return []
    return this.groupsOf(this.activeWorktreeId)
      .map((g, i) => ({ id: g.active, group: i }))
      .filter((p) => p.id)
  }
  visibleSessions(): string[] {
    return this.visiblePanes().map((p) => p.id)
  }
  isSplit(): boolean {
    return this.activeWorktreeId ? this.groupsOf(this.activeWorktreeId).length > 1 : false
  }
  /** Ensure colFr matches the group count; returns {cols, visible}. */
  computeGrid(): { cols: number; visible: string[] } {
    const visible = this.visibleSessions()
    const cols = Math.max(this.activeWorktreeId ? this.groupsOf(this.activeWorktreeId).length : 1, 1)
    if (this.colFr.length !== cols) this.colFr = Array(cols).fill(1)
    return { cols, visible }
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
  private upsertProject(
    repoRoot: string,
    name: string,
    hooks?: { hookCreate?: string; hookRemove?: string }
  ): ProjectView {
    let p = this.projects.get(repoRoot)
    if (!p) {
      p = { repoRoot, name, expanded: false, loaded: false, worktrees: new Map() }
      this.projects.set(repoRoot, p)
    }
    if (hooks) {
      p.hookCreate = hooks.hookCreate
      p.hookRemove = hooks.hookRemove
    }
    return p
  }
  updateProjectHooks(repoRoot: string, patch: { hookCreate?: string; hookRemove?: string }): void {
    const p = this.projects.get(repoRoot)
    if (!p) return
    if (patch.hookCreate !== undefined) p.hookCreate = patch.hookCreate
    if (patch.hookRemove !== undefined) p.hookRemove = patch.hookRemove
    window.api.projectUpdate(repoRoot, patch)
    this.notify()
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
      // Place the new session in the currently-focused group.
      const groups = this.groupsOf(worktreeId) // reconciles: adds snap.id to group 0
      const gi = this.focusedGroup(worktreeId)
      if (gi !== 0) {
        groups[0].ids = groups[0].ids.filter((x) => x !== snap.id)
        groups[gi].ids.push(snap.id)
      }
      groups[gi].active = snap.id
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
  /** Open the rename popup for a session (double-click a tab or the shortcut). */
  promptRename(id: string | null): void {
    const s = id ? this.sessions.get(id) : undefined
    if (s) this.openDialog({ kind: 'renameSession', id: s.id, title: s.title })
  }
  renameFocused(): void {
    this.promptRename(this.focusedSessionId)
  }
  closeSession(id: string, quiet = false): void {
    window.api.sessionKill(id)
    const wtId = this.sessions.get(id)?.worktreeId
    this.sessions.delete(id)
    this.pending.delete(id)
    this.lastLine.delete(id)
    // Reconcile groups (drops the id, collapses an emptied split) and re-focus.
    if (wtId) {
      const groups = this.groupsOf(wtId)
      if (this.focusedSessionId === id) {
        const gi = this.focusedGroup(wtId)
        this.focusedSessionId = groups[gi]?.active ?? groups[0]?.active ?? null
      }
    }
    if (!quiet) {
      this.persistLayout()
      this.notify()
    }
  }
  focusSession(id: string): void {
    const s = this.sessions.get(id)
    if (s) {
      const groups = this.groupsOf(s.worktreeId)
      const gi = groups.findIndex((g) => g.ids.includes(id))
      if (gi >= 0) {
        groups[gi].active = id
        this.focusedGroupByWt.set(s.worktreeId, gi)
      }
    }
    this.focusedSessionId = id
    this.pending.delete(id)
    this.notify()
    this.panes.get(id)?.term.focus()
  }
  /** Cycle focus among the focused group's tabs (delta +1 / -1). */
  cycleSession(delta: number): void {
    if (!this.activeWorktreeId) return
    const groups = this.groupsOf(this.activeWorktreeId)
    const ids = groups[this.focusedGroup(this.activeWorktreeId)]?.ids ?? []
    if (ids.length < 2) return
    const i = ids.indexOf(this.focusedSessionId ?? '')
    const next = ids[(((i < 0 ? 0 : i) + delta) % ids.length + ids.length) % ids.length]
    if (next) this.focusSession(next)
  }
  /** Focus the active session of a group (0 = left, 1 = right). */
  focusGroup(index: number): void {
    if (!this.activeWorktreeId) return
    const g = this.groupsOf(this.activeWorktreeId)[index]
    if (g?.active) this.focusSession(g.active)
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

  // --- split (VS Code editor groups) / notifications --------------------
  toggleSplit(): void {
    const wt = this.activeWorktreeId
    if (!wt) return
    const groups = this.groupsOf(wt)
    if (groups.length > 1) {
      // Merge back to a single group (keep order, keep focus).
      const merged = groups.flatMap((g) => g.ids)
      this.groupsByWt.set(wt, [{ ids: merged, active: this.focusedSessionId ?? merged[0] ?? '' }])
      this.focusedGroupByWt.set(wt, 0)
      this.notify()
      return
    }
    const g0 = groups[0]
    if (g0.ids.length >= 2) {
      // Move the focused session into a new right group.
      const fid = g0.ids.includes(this.focusedSessionId ?? '') ? this.focusedSessionId! : g0.active
      g0.ids = g0.ids.filter((x) => x !== fid)
      g0.active = g0.ids[g0.ids.length - 1] ?? ''
      groups.push({ ids: [fid], active: fid })
      this.focusedGroupByWt.set(wt, 1)
      this.focusedSessionId = fid
      this.notify()
    } else {
      // Only one session — open a fresh shell in a new right group.
      groups.push({ ids: [], active: '' })
      this.focusedGroupByWt.set(wt, 1)
      void this.addSession(wt, 'shell')
    }
  }
  /** Drag-and-drop: move session `id` into `targetGroup` before `beforeId`
   * (or to the end), reordering within a group or moving between groups. */
  reorderSession(id: string, targetGroup: number, beforeId?: string): void {
    const wt = this.sessions.get(id)?.worktreeId
    if (!wt || wt !== this.activeWorktreeId) return
    const groups = this.groupsOf(wt)
    if (targetGroup < 0 || targetGroup >= groups.length) return
    const from = groups.findIndex((g) => g.ids.includes(id))
    if (from < 0) return
    groups[from].ids = groups[from].ids.filter((x) => x !== id)
    const dest = groups[targetGroup].ids
    const at = beforeId && beforeId !== id ? dest.indexOf(beforeId) : -1
    dest.splice(at < 0 ? dest.length : at, 0, id)
    groups[targetGroup].active = id
    if (from !== targetGroup) groups[from].active = groups[from].ids[groups[from].ids.length - 1] ?? ''
    this.focusedGroupByWt.set(wt, targetGroup)
    this.focusedSessionId = id
    this.groupsOf(wt) // reconcile (collapse an emptied source group)
    this.notify()
  }
  /** Move the focused session to the other group (creating one if needed). */
  moveFocusedToGroup(target: number): void {
    const wt = this.activeWorktreeId
    const fid = this.focusedSessionId
    if (!wt || !fid) return
    const groups = this.groupsOf(wt)
    const from = groups.findIndex((g) => g.ids.includes(fid))
    if (from < 0) return
    if (target >= groups.length) groups.push({ ids: [], active: '' })
    if (from === target) return
    groups[from].ids = groups[from].ids.filter((x) => x !== fid)
    groups[from].active = groups[from].ids[groups[from].ids.length - 1] ?? ''
    groups[target].ids.push(fid)
    groups[target].active = fid
    this.focusedGroupByWt.set(wt, target)
    this.groupsOf(wt) // reconcile (drops an emptied source group)
    this.notify()
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
    root.style.setProperty('--fg', s.foreground)
    const termBg = s.transparent ? hexToRgba(s.background, s.opacity) : s.background
    if (s.transparent) {
      document.body.style.background = 'transparent'
      root.style.setProperty('--pane-bg', termBg)
      root.style.setProperty('--panel', hexToRgba(s.background, Math.min(1, s.opacity + 0.12)))
      root.style.setProperty('--panel-2', hexToRgba(s.background, Math.min(1, s.opacity + 0.2)))
    } else {
      document.body.style.background = s.background
      root.style.setProperty('--pane-bg', s.background)
      root.style.setProperty('--panel', mix(s.background, '#ffffff', 0.06))
      root.style.setProperty('--panel-2', mix(s.background, '#ffffff', 0.11))
    }
    // Apply the theme to live terminals too (background + foreground).
    for (const { term } of this.panes.values()) {
      try {
        term.options.allowTransparency = s.transparent
        term.options.theme = { background: termBg, foreground: s.foreground }
      } catch {
        /* ignore */
      }
    }
  }
  /** Terminal background to pass to a freshly created Terminal. */
  terminalTheme(): { background: string; foreground: string } {
    const s = this.settings
    return {
      background: s.transparent ? hexToRgba(s.background, s.opacity) : s.background,
      foreground: s.foreground
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
    for (const p of recent)
      this.upsertProject(p.repoRoot, p.name, { hookCreate: p.hookCreate, hookRemove: p.hookRemove })
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
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}
/** Blend `a` toward `b` by `t` (0..1); used to derive panel shades from the bg. */
function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return a
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

function errMsg(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(/^Error: Error invoking remote method '[^']*':\s*/, '')
    .replace(/^\w*Error:\s*/, '')
}

export const store = new Store()
