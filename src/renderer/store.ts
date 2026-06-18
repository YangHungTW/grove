import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { SessionKind, SessionState } from '../core/types'
import type { WorktreeUsage } from '../core/claudeUsage'
import type { PrInfo } from '../core/gh'
import type { SessionSnapshot } from '../main/ipc'
import type { SessionDescriptor } from '../core/layoutStore'
import type { ClosedAgent } from '../core/closedAgentsStore'
import { buildAgentLaunch } from '../core/resume'
import { classifyExit } from '../core/sessionExit'
import { wrapIndex } from '../core/cycle'
import { canOpenInIde } from '../core/ideLaunch'
import {
  DEFAULT_SETTINGS,
  SHELL_ICON,
  FONT_FALLBACK,
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
  | { kind: 'branchExists'; repoRoot: string; projectName: string; branch: string }
  | { kind: 'removeWorktree'; repoRoot: string; wtId: string; branch: string; folder: string }
  | { kind: 'projectSettings'; repoRoot: string; name: string }
  | { kind: 'renameSession'; id: string; title: string }
  | { kind: 'openFile'; worktreeId: string }
  | { kind: 'finishWorktree'; repoRoot: string; wtId: string; branch: string }

/** Tab/sidebar icon char for a file-viewer pane (mapped to a doc SVG). */
export const VIEWER_ICON = '▤'
/** Tab/sidebar icon char for a diff/review pane (mapped to a diff SVG). */
export const DIFF_ICON = '±'

interface PaneRef {
  term: Terminal
  fit: FitAddon
  search?: SearchAddon
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

/** Grove's terminal search (xterm SearchAddon) traverses the full buffer
 * INCLUDING scrollback — but only the 'normal' buffer HAS scrollback. An app on
 * the 'alternate' buffer owns its screen and scroll (so its history is not in
 * xterm's buffer), meaning search there can only reach what is currently visible.
 * This is a property of the running app/terminal, not of Grove's search wiring. */
export function searchCoversScrollback(bufferType?: string): boolean {
  return bufferType !== 'alternate'
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
  /** Today's Claude token/cost usage per worktree (from transcript files). */
  wtUsage = new Map<string, WorktreeUsage>()
  /** PR + CI summary per worktree branch (gh CLI; absent = no PR or no gh). */
  wtPr = new Map<string, PrInfo>()
  activeProjectId: string | null = null
  activeWorktreeId: string | null = null
  focusedSessionId: string | null = null
  colFr: number[] = []
  rowFr: number[] = []
  settings: AppSettings = { ...DEFAULT_SETTINGS }
  settingsOpen = false
  /** Whether the TabBar's agent-chooser menu is open (driven by the button AND
   * the New-agent keyboard shortcut). */
  /** New-session picker (⌘T): open state + highlighted index. */
  pickerOpen = false
  pickerIndex = 0
  availableAgents: ResolvedAgent[] = []
  dialog: DialogState | null = null
  /** Recently-closed resumable agents (most-recent-first), persisted to disk. */
  closedAgents: ClosedAgent[] = []
  /** Session temporarily maximized over the whole grid (iTerm-style zoom). */
  zoomedSessionId: string | null = null
  /** Session whose terminal search bar is open (the focused one), or null. */
  searchSessionId: string | null = null
  /** Durable agent panes masked while their tmux (re)attach settles (so no
   * half-painted reattach frame is shown). */
  private settling = new Set<string>()
  /** Durable agents that have already done their one-time settle mask (so we
   * don't re-mask on every worktree switch — only on the first attach). */
  private settledOnce = new Set<string>()

  // Live agents that own a pinned resume id, keyed by session id. On close the
  // entry becomes a ClosedAgent so the agent can be resumed later.
  private resumeMeta = new Map<string, { resumeId: string; baseCommand: string }>()
  // Stable per-agent durable (tmux) key, keyed by session id. Persisted in the
  // layout so a relaunch reattaches to the same tmux session; distinct per agent
  // so two agents in one worktree never share one. See [[tmuxSessionName]].
  private durableKeyById = new Map<string, string>()
  private savedLayout: SessionDescriptor[] = []
  // Worktree paths whose saved sessions have been respawned this run (lazy
  // restore happens per worktree, on first select — not all at once on launch).
  private restoredWorktrees = new Set<string>()
  private restoring = false
  private repoRoot = ''
  private prevVisible: string[] = []
  private lineRefreshScheduled = false
  // Panes that received output and need a forced repaint. xterm's canvas/WebGL
  // renderers track dirty rows themselves and skip a redraw when they believe a
  // row is unchanged — but an agent that repaints its status/cost line IN PLACE
  // (rewriting the same bottom row) can slip past that tracking on some GPUs,
  // leaving the row stale until a resize or text selection forces a full redraw.
  // We coalesce a full refresh per output burst to flush those missed rows.
  private refreshPanes = new Set<string>()
  private refreshScheduled = false

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
  /** True when the worktree's agent is durable (tmux-backed) — survives a Grove
   * restart. Drives the sidebar's durable badge. */
  worktreeDurable(wtId: string): boolean {
    return this.sessionsOf(wtId).some((s) => s.kind === 'agent' && s.durable)
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
  /** The visible panes (active session of each group), in column order. When a
   * session is zoomed it is the only visible pane, occupying the full grid. */
  visiblePanes(): { id: string; group: number }[] {
    if (!this.activeWorktreeId) return []
    const z = this.zoomedSessionId ? this.sessions.get(this.zoomedSessionId) : undefined
    if (z && z.worktreeId === this.activeWorktreeId) return [{ id: z.id, group: 0 }]
    return this.groupsOf(this.activeWorktreeId)
      .map((g, i) => ({ id: g.active, group: i }))
      .filter((p) => p.id)
  }
  isZoomed(): boolean {
    const z = this.zoomedSessionId ? this.sessions.get(this.zoomedSessionId) : undefined
    return !!z && z.worktreeId === this.activeWorktreeId
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
    const cols = this.isZoomed()
      ? 1
      : Math.max(this.activeWorktreeId ? this.groupsOf(this.activeWorktreeId).length : 1, 1)
    if (this.colFr.length !== cols) this.colFr = Array(cols).fill(1)
    return { cols, visible }
  }

  // --- terminal registration (called by <Pane>) --------------------------
  registerPane(id: string, term: Terminal, fit: FitAddon, search?: SearchAddon): void {
    this.panes.set(id, { term, fit, search })
  }
  /** Force a full repaint of panes that just received output, coalesced per
   * burst. Works around xterm canvas/WebGL renderers skipping an in-place row
   * rewrite (e.g. an agent's cost/status line) so it stays stale until a manual
   * resize/selection. A short debounce keeps this to ~one repaint per burst. */
  private scheduleRepaint(id: string): void {
    this.refreshPanes.add(id)
    if (this.refreshScheduled) return
    this.refreshScheduled = true
    setTimeout(() => {
      this.refreshScheduled = false
      for (const pid of this.refreshPanes) {
        const term = this.panes.get(pid)?.term
        if (term) term.refresh(0, term.rows - 1)
      }
      this.refreshPanes.clear()
    }, 80)
  }
  unregisterPane(id: string): void {
    this.panes.get(id)?.term.dispose()
    this.panes.delete(id)
    this.settling.delete(id)
    this.settledOnce.delete(id)
  }
  /** True while a durable agent pane is masked during its (re)attach settle. */
  isSettling(id: string): boolean {
    return this.settling.has(id)
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
        // The rows-1→rows bounce forces a full-screen TUI to repaint. Plain
        // shells don't need it — for them each extra SIGWINCH just reprints
        // the prompt, stacking stale copies in the scrollback.
        if (newlyShown.includes(id) && rows > 1 && this.sessions.get(id)?.kind === 'agent') {
          if (this.sessions.get(id)?.durable && !this.settledOnce.has(id)) {
            // First (re)attach of a durable agent: tmux replays the old screen and
            // only fully repaints on a real size CHANGE, so the first frames can be
            // half-painted (left-edge bleed / stale glyphs). Mask the pane, force a
            // clean repaint underneath (a delayed bounce tmux won't coalesce — the
            // rAF-adjacent one does), then reveal — the user never sees a bad frame.
            this.settledOnce.add(id)
            this.settling.add(id)
            this.notify()
            setTimeout(() => {
              const p = this.panes.get(id)
              if (!p) return
              p.term.resize(cols, rows - 1)
              window.api.sessionResize(id, cols, rows - 1)
            }, 350)
            setTimeout(() => {
              const p = this.panes.get(id)
              if (!p) return
              p.term.resize(cols, rows)
              window.api.sessionResize(id, cols, rows)
            }, 480)
            setTimeout(() => {
              this.settling.delete(id)
              this.notify()
            }, 750)
          } else {
            pane.term.resize(cols, rows - 1)
            window.api.sessionResize(id, cols, rows - 1)
            requestAnimationFrame(() => {
              pane.term.resize(cols, rows)
              window.api.sessionResize(id, cols, rows)
            })
          }
        }
      }
    })
  }

  // --- persistence -------------------------------------------------------
  private currentDescriptors(): SessionDescriptor[] {
    const out: SessionDescriptor[] = []
    for (const project of this.projects.values())
      for (const wt of project.worktrees.values())
        for (const s of this.sessionsOf(wt.id)) {
          // Viewer/diff panes are transient views — not worth restoring.
          if (s.kind === 'viewer' || s.kind === 'diff') continue
          out.push({
            repoRoot: project.repoRoot,
            worktreePath: wt.path,
            kind: s.kind,
            title: s.title,
            icon: s.icon,
            // Persist the agent's pinned resume id so a relaunch can `--resume`
            // back into the same conversation. undefined → omitted by JSON.
            resumeId: this.resumeMeta.get(s.id)?.resumeId,
            // Mark durable agents so the card can show it; on restore the agent
            // relaunches durable and tmux reattaches to the still-live process.
            durable: s.durable,
            // The per-agent tmux key, so restore reattaches to the SAME session.
            durableKey: this.durableKeyById.get(s.id)
          })
        }
    return out
  }
  private persistLayout(): void {
    if (this.restoring) return
    // Keep saved descriptors for worktrees not yet restored this run; replace the
    // rest with their live sessions.
    const keep = this.savedLayout.filter((d) => !this.restoredWorktrees.has(d.worktreePath))
    const merged = [...keep, ...this.currentDescriptors()]
    this.savedLayout = merged
    window.api.layoutSave(merged)
  }
  /** Lazily respawn a worktree's saved sessions on first select. Agents that were
   * launched with a pinned session id reopen via `claude --resume <id>` so the
   * conversation continues; everything else respawns fresh. */
  private async restoreWorktree(wtId: string): Promise<void> {
    if (this.restoredWorktrees.has(wtId)) return
    this.restoredWorktrees.add(wtId)
    const toRestore = this.savedLayout.filter((d) => d.worktreePath === wtId)
    if (toRestore.length === 0) return
    this.restoring = true
    for (const d of toRestore) {
      // Recover which agent this was from its icon so codex/gemini restore as
      // themselves (not the default), and keep the saved/renamed title.
      const agentDef =
        d.kind === 'agent' ? this.availableAgents.find((a) => a.icon === d.icon) : undefined
      await this.addSession(wtId, d.kind, agentDef, d.title, d.resumeId, d.durableKey)
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
      this.refreshWorktreeMeta(wt.id)
      if (!wt.primary) this.refreshPr(wt.id)
    }
  }

  /**
   * Re-list worktrees from disk and ADD any not already in the sidebar — so a
   * worktree created outside the New-worktree dialog (an external terminal, an
   * agent/shell pane running `git worktree add`, etc.) shows up without an app
   * restart. Non-destructive (unlike loadWorktrees, which clears the map) and
   * add-only, so it never disturbs existing cards/sessions. Returns true if it
   * added anything.
   */
  private async reconcileWorktrees(project: ProjectView): Promise<boolean> {
    if (!project.loaded) return false
    const list = await window.api.worktreeList(project.repoRoot).catch(() => null)
    if (!list) return false
    let added = false
    list.forEach((w, i) => {
      if (project.worktrees.has(w.path)) return
      const primary = i === 0 || w.path === project.repoRoot
      project.worktrees.set(w.path, { id: w.path, path: w.path, branch: w.branch, primary })
      this.refreshWorktreeMeta(w.path)
      if (!primary) this.refreshPr(w.path)
      added = true
    })
    return added
  }

  /** Reconcile every loaded project; notify the UI if any new worktree appeared. */
  async reconcileAllWorktrees(): Promise<void> {
    let added = false
    for (const p of this.projects.values()) if (await this.reconcileWorktrees(p)) added = true
    if (added) this.notify()
  }

  /** The WorktreeView for an id (= path), across all projects. */
  private worktreeOf(wtId: string): WorktreeView | undefined {
    for (const p of this.projects.values()) {
      const wt = p.worktrees.get(wtId)
      if (wt) return wt
    }
    return undefined
  }

  /** Refresh a worktree card's live metadata: branch + git status + Claude usage. */
  private refreshWorktreeMeta(wtId: string): void {
    window.api
      .worktreeStatus(wtId)
      .then((s) => {
        this.wtStatus.set(wtId, s)
        // Track an in-terminal `git checkout` / branch rename so the card name
        // stays current (it was otherwise only set on the initial load).
        const wt = this.worktreeOf(wtId)
        if (wt && s.branch && wt.branch !== s.branch) wt.branch = s.branch
        this.notify()
      })
      .catch(() => {})
    window.api
      .claudeUsage(wtId)
      .then((u) => {
        const had = this.wtUsage.has(wtId)
        if (u) this.wtUsage.set(wtId, u)
        else this.wtUsage.delete(wtId)
        if (u || had) this.notify()
      })
      .catch(() => {})
  }

  /** Refresh a feature worktree's PR/CI badge (no-op without gh or a PR). */
  private refreshPr(wtId: string): void {
    window.api
      .prStatus(wtId)
      .then((pr) => {
        const had = this.wtPr.has(wtId)
        if (pr) this.wtPr.set(wtId, pr)
        else this.wtPr.delete(wtId)
        if (pr || had) this.notify()
      })
      .catch(() => {})
  }

  /** Periodic card refresh — git status and token usage would otherwise go
   * stale the moment an agent starts committing/working. PR status polls on a
   * slower cadence (each check is a gh API round-trip). */
  private startMetaPolling(): void {
    setInterval(() => {
      if (document.hidden) return
      // Pick up worktrees created outside the sidebar, then refresh live meta.
      void this.reconcileAllWorktrees()
      for (const p of this.projects.values())
        for (const wt of p.worktrees.values()) this.refreshWorktreeMeta(wt.id)
    }, 20_000)
    setInterval(() => {
      if (document.hidden) return
      for (const p of this.projects.values())
        for (const wt of p.worktrees.values()) if (!wt.primary) this.refreshPr(wt.id)
    }, 60_000)
  }

  /**
   * One-click wrap-up for a feature worktree: commit whatever is dirty, then
   * merge into the default branch (optionally removing the worktree) or push +
   * open a PR. Returns false (with a toast) on the first failing step.
   */
  async finishWorktree(opts: {
    repoRoot: string
    wtId: string
    branch: string
    message: string
    action: 'merge' | 'pr' | 'commit'
    removeAfter: boolean
  }): Promise<boolean> {
    try {
      const st = await window.api.worktreeStatus(opts.wtId)
      if (st.dirty > 0) await window.api.worktreeCommitAll(opts.wtId, opts.message.trim())
      if (opts.action === 'merge') {
        const target = await window.api.worktreeMergeToDefault(opts.repoRoot, opts.branch)
        this.toast(`Merged ${opts.branch} into ${target}`)
        if (opts.removeAfter) {
          const p = this.projects.get(opts.repoRoot)
          // Branch was just merged, so deleting it with the worktree is safe.
          if (p) await this.removeWorktree(p, opts.wtId, true)
        }
      } else if (opts.action === 'pr') {
        await window.api.worktreePush(opts.wtId)
        const url = await window.api.prCreate(opts.wtId)
        this.toast(`PR created: ${url}`)
        window.api.openExternal(url)
        this.refreshPr(opts.wtId)
      } else {
        this.toast(`Committed on ${opts.branch}`)
      }
      this.refreshWorktreeMeta(opts.wtId)
      this.notify()
      return true
    } catch (err) {
      this.toast(errMsg(err))
      return false
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
    this.activeWorktreeId = p.worktrees.keys().next().value ?? null
    if (this.activeWorktreeId) await this.restoreWorktree(this.activeWorktreeId)
    this.syncFocus()
    this.notify()
  }
  async removeProject(repoRoot: string): Promise<void> {
    for (const wt of this.projects.get(repoRoot)?.worktrees.values() ?? [])
      for (const s of this.sessionsOf(wt.id)) this.closeSession(s.id, true)
    await window.api.projectRemove(repoRoot)
    this.projects.delete(repoRoot)
    this.savedLayout = this.savedLayout.filter((d) => d.repoRoot !== repoRoot)
    this.closedAgents = this.closedAgents.filter((c) => c.repoRoot !== repoRoot)
    this.persistClosedAgents()
    if (this.activeProjectId === repoRoot) {
      this.activeProjectId = this.projects.keys().next().value ?? null
      this.activeWorktreeId = this.activeProject()?.worktrees.keys().next().value ?? null
    }
    this.persistLayout()
    this.notify()
  }

  // --- worktrees ---------------------------------------------------------
  async createWorktree(project: ProjectView, branch: string, useExisting = false): Promise<void> {
    try {
      // Path is computed by main from the worktreeFolder setting (+ runs hooks).
      // useExisting=false creates a new branch (-b); true checks out an existing one.
      const info = await window.api.worktreeCreate(project.repoRoot, {
        branch,
        newBranch: !useExisting
      })
      project.worktrees.set(info.path, {
        id: info.path,
        path: info.path,
        branch: info.branch || branch,
        primary: false
      })
      this.activeProjectId = project.repoRoot
      this.activeWorktreeId = info.path
      this.refreshWorktreeMeta(info.path)
      this.syncFocus()
    } catch (err) {
      // A new-branch name that already exists: offer to open it instead of failing.
      if (!useExisting && errMsg(err).includes('BRANCH_EXISTS')) {
        this.openDialog({
          kind: 'branchExists',
          repoRoot: project.repoRoot,
          projectName: project.name,
          branch
        })
        return
      }
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
    this.wtStatus.delete(wtId)
    this.wtUsage.delete(wtId)
    this.wtPr.delete(wtId)
    this.savedLayout = this.savedLayout.filter((d) => d.worktreePath !== wtId)
    this.restoredWorktrees.delete(wtId)
    this.closedAgents = this.closedAgents.filter((c) => c.worktreePath !== wtId)
    this.persistClosedAgents()
    if (this.activeWorktreeId === wtId)
      this.activeWorktreeId = project.worktrees.keys().next().value ?? null
    this.persistLayout()
    this.notify()
  }
  async selectWorktree(projectId: string, wtId: string): Promise<void> {
    this.activeProjectId = projectId
    this.activeWorktreeId = wtId
    if (this.activeWorktreeId !== this.sessions.get(this.zoomedSessionId ?? '')?.worktreeId)
      this.zoomedSessionId = null
    await this.restoreWorktree(wtId) // respawn this worktree's sessions on first select
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
  /** Cycle the active worktree within the active project (delta +1 / -1, wraps). */
  cycleWorktree(delta: number): void {
    const p = this.activeProject()
    if (!p) return
    const wts = [...p.worktrees.values()]
    if (wts.length < 2) return
    const i = wts.findIndex((w) => w.id === this.activeWorktreeId)
    const next = wts[wrapIndex(i, delta, wts.length)]
    if (next) void this.selectWorktree(p.repoRoot, next.id)
  }
  /** Cycle the active project (delta +1 / -1, wraps). */
  cycleProject(delta: number): void {
    const ids = [...this.projects.keys()]
    if (ids.length < 2) return
    const i = ids.indexOf(this.activeProjectId ?? '')
    const next = ids[wrapIndex(i, delta, ids.length)]
    if (next) void this.setActiveProject(next)
  }

  // --- sessions ----------------------------------------------------------
  async addSession(
    worktreeId: string,
    kind: SessionKind,
    agentDef?: AgentDef,
    titleOverride?: string,
    resumeId?: string,
    durableKey?: string
  ): Promise<void> {
    const wt = this.activeProject()?.worktrees.get(worktreeId)
    if (!wt) return
    const isAgent = kind === 'agent'
    const icon = isAgent ? (agentDef?.icon ?? '★') : SHELL_ICON
    const baseName = isAgent ? (agentDef?.name?.toLowerCase() ?? 'agent') : 'shell'
    const baseCommand = isAgent ? (agentDef?.command ?? 'claude') : 'shell'
    const detect = isAgent ? (agentDef?.id ?? 'claude') : undefined
    // Pin a resume id for claude-family agents so we can resume them after close.
    // Grove owns the id (claude doesn't print it): `--session-id` for a fresh
    // session, `--resume` to reopen the one a closed agent left behind.
    const launch = isAgent
      ? buildAgentLaunch(baseCommand, () => crypto.randomUUID(), resumeId)
      : { command: baseCommand }
    const command = launch.command
    // Stable per-agent id for durable (tmux) naming. Distinct from resumeId
    // (which is claude-only): EVERY agent gets one so two agents in a worktree
    // can't collide onto one tmux session. Reused on restore so reattach finds
    // the right live session. Generated once per logical agent here.
    const dKey = isAgent ? (durableKey ?? crypto.randomUUID()) : undefined
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
        cols,
        durableKey: dKey
      })
      this.sessions.set(snap.id, snap)
      if (launch.resumeId) this.resumeMeta.set(snap.id, { resumeId: launch.resumeId, baseCommand })
      if (dKey) this.durableKeyById.set(snap.id, dKey)
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
  /** Open the "open file" dialog for a worktree (or the active one). */
  promptOpenFile(worktreeId?: string): void {
    const wt = worktreeId ?? this.activeWorktreeId
    if (wt) this.openDialog({ kind: 'openFile', worktreeId: wt })
  }
  /** Native file picker (Markdown/HTML), starting in the worktree folder.
   * Returns the chosen path or null. */
  async browseForFile(worktreeId?: string): Promise<string | null> {
    const wt = worktreeId ?? this.activeWorktreeId ?? undefined
    try {
      return await window.api.fileOpenDialog(wt)
    } catch (err) {
      this.toast(errMsg(err))
      return null
    }
  }
  /** Insert a freshly-created non-pty pane (viewer/diff) into the focused group
   * and focus it. Mirrors the placement tail of addSession. */
  private placePane(worktreeId: string, snap: SessionSnapshot): void {
    this.sessions.set(snap.id, snap)
    this.activeWorktreeId = worktreeId
    const groups = this.groupsOf(worktreeId)
    const gi = this.focusedGroup(worktreeId)
    if (gi !== 0) {
      groups[0].ids = groups[0].ids.filter((x) => x !== snap.id)
      groups[gi].ids.push(snap.id)
    }
    groups[gi].active = snap.id
    this.focusedSessionId = snap.id
    this.persistLayout()
  }
  /** Open a read-only diff/review pane for what `wtId` changed. */
  async reviewWorktreeChanges(repoRoot: string, wtId: string): Promise<void> {
    await this.selectWorktree(repoRoot, wtId)
    const wt = this.activeProject()?.worktrees.get(wtId)
    if (!wt) return
    try {
      const snap = await window.api.sessionCreate({
        worktreeId: wtId,
        kind: 'diff',
        command: '',
        cwd: wt.path,
        title: 'Changes',
        icon: DIFF_ICON,
        filePath: wt.path
      })
      this.placePane(wtId, snap)
    } catch (err) {
      this.toast(errMsg(err))
    }
    this.notify()
  }
  /** Open `filePath` as a read-only viewer pane in `worktreeId`. The viewer kind
   * is inferred from the extension (.html/.htm → html, else markdown). */
  async openFile(worktreeId: string, filePath: string): Promise<void> {
    const wt = this.activeProject()?.worktrees.get(worktreeId)
    const path = filePath.trim()
    if (!wt || !path) return
    const lower = path.toLowerCase()
    const viewerKind: 'markdown' | 'html' =
      lower.endsWith('.html') || lower.endsWith('.htm') ? 'html' : 'markdown'
    const title = path.split('/').pop() || path
    try {
      const snap = await window.api.sessionCreate({
        worktreeId,
        kind: 'viewer',
        command: '',
        cwd: wt.path,
        title,
        icon: VIEWER_ICON,
        filePath: path,
        viewerKind
      })
      this.placePane(worktreeId, snap)
    } catch (err) {
      this.toast(errMsg(err))
    }
    this.notify()
  }
  /** Whether the open-in-IDE action is available (an IDE is configured). */
  canOpenInIde(): boolean {
    return canOpenInIde(this.settings)
  }
  /** Open `filePath` (absolute) in the configured IDE. A terminal editor opens in
   * a new in-app shell pane; a GUI editor launches as a process. No-op (toast)
   * when no IDE is configured. */
  async openInIde(worktreeId: string, filePath: string): Promise<void> {
    if (!this.canOpenInIde()) {
      this.toast('No editor configured — set one in Settings')
      return
    }
    const wt = this.activeProject()?.worktrees.get(worktreeId)
    if (!wt) return
    const root = document.getElementById('panes')
    const cols = root ? Math.max(20, Math.floor(root.clientWidth / 7.8)) : 80
    try {
      const snap = await window.api.ideOpen(filePath, { worktreeId, cwd: wt.path, cols })
      // Terminal editors come back as a shell pane to place; GUI editors return null.
      if (snap) this.placePane(worktreeId, snap)
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
    const sess = this.sessions.get(id)
    const wtId = sess?.worktreeId
    // A resumable agent closed by the user (not torn down in bulk) goes to the
    // recently-closed list so it can be relaunched with `claude --resume <id>`.
    const meta = this.resumeMeta.get(id)
    if (!quiet && meta && sess) this.recordClosedAgent(sess, meta, this.durableKeyById.get(id))
    this.resumeMeta.delete(id)
    this.durableKeyById.delete(id)
    this.sessions.delete(id)
    this.pending.delete(id)
    this.syncBadge()
    this.lastLine.delete(id)
    if (this.zoomedSessionId === id) this.zoomedSessionId = null
    if (this.searchSessionId === id) this.searchSessionId = null
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

  // --- recently-closed agents (resume) -----------------------------------
  /** repoRoot that owns a worktree id (= path), for keying closed-agent entries. */
  private repoRootOf(wtId: string): string | undefined {
    for (const p of this.projects.values()) if (p.worktrees.has(wtId)) return p.repoRoot
  }
  private recordClosedAgent(
    sess: SessionSnapshot,
    meta: { resumeId: string; baseCommand: string },
    durableKey?: string
  ): void {
    const entry: ClosedAgent = {
      repoRoot: this.repoRootOf(sess.worktreeId) ?? '',
      worktreePath: sess.worktreeId,
      resumeId: meta.resumeId,
      baseCommand: meta.baseCommand,
      title: sess.title,
      icon: sess.icon,
      closedAt: Date.now(),
      // Carry the durable key so reopening reattaches to the still-live tmux
      // process (closing a durable agent kills only the control client).
      durableKey
    }
    // Dedupe by resume id (resuming then re-closing the same session), newest first.
    this.closedAgents = [entry, ...this.closedAgents.filter((c) => c.resumeId !== entry.resumeId)]
    this.persistClosedAgents()
  }
  /** Recently-closed resumable agents for a worktree (= path), most-recent-first. */
  closedAgentsOf(wtId: string): ClosedAgent[] {
    return this.closedAgents.filter((c) => c.worktreePath === wtId)
  }
  /** Relaunch a closed agent with `--resume`, reusing its pinned session id. */
  resumeClosedAgent(c: ClosedAgent): void {
    this.closedAgents = this.closedAgents.filter((x) => x.resumeId !== c.resumeId)
    this.persistClosedAgents()
    const agentDef: AgentDef = {
      id: 'claude',
      name: c.title,
      command: c.baseCommand,
      icon: c.icon ?? '★'
    }
    void this.addSession(c.worktreePath, 'agent', agentDef, c.title, c.resumeId, c.durableKey)
  }
  /** Drop a closed agent from the list without resuming it. */
  forgetClosedAgent(c: ClosedAgent): void {
    this.closedAgents = this.closedAgents.filter((x) => x.resumeId !== c.resumeId)
    this.persistClosedAgents()
    this.notify()
  }
  private persistClosedAgents(): void {
    window.api.closedAgentsSave(this.closedAgents)
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
    // Switching focus to a different session leaves zoom/search mode (iTerm-style).
    if (this.zoomedSessionId && this.zoomedSessionId !== id) this.zoomedSessionId = null
    if (this.searchSessionId && this.searchSessionId !== id) this.closeSearch(false)
    this.focusedSessionId = id
    this.pending.delete(id)
    this.syncBadge()
    this.notify()
    this.panes.get(id)?.term.focus()
  }

  // --- zoom (temporarily maximize the focused pane) ----------------------
  toggleZoom(): void {
    if (this.isZoomed()) {
      this.zoomedSessionId = null
    } else {
      const id = this.focusedSessionId
      if (!id || !this.sessions.has(id)) return
      this.zoomedSessionId = id
    }
    this.notify()
    this.fitVisible()
  }

  // --- in-terminal search (xterm SearchAddon) -----------------------------
  /** Open the search bar for the focused terminal pane (no-op for viewer/diff). */
  openSearch(): void {
    const id = this.focusedSessionId
    if (!id || !this.panes.has(id)) return
    this.searchSessionId = id
    this.notify()
  }
  /** Whether terminal search can only reach the visible screen for the pane whose
   * search bar is open: true when the app has put xterm on the ALTERNATE buffer
   * (a full-screen TUI like Claude Code that paints + scrolls its own transcript),
   * which has no xterm scrollback for SearchAddon to traverse. Lets the UI say so
   * rather than silently finding only on-screen matches. */
  searchLimitedToScreen(): boolean {
    const id = this.searchSessionId
    const term = id ? this.panes.get(id)?.term : undefined
    return !searchCoversScrollback(term?.buffer.active.type)
  }
  closeSearch(refocus = true): void {
    const id = this.searchSessionId
    if (!id) return
    this.searchSessionId = null
    const pane = this.panes.get(id)
    pane?.search?.clearDecorations()
    pane?.term.clearSelection()
    this.notify()
    if (refocus) pane?.term.focus()
  }

  /** Send a canned keystroke to a waiting agent (sidebar quick-respond). */
  quickRespond(id: string, data: string): void {
    window.api.sessionInput(id, data)
    this.pending.delete(id)
    this.syncBadge()
    this.notify()
  }
  /** Cycle focus among the focused group's tabs (delta +1 / -1). */
  cycleSession(delta: number): void {
    if (!this.activeWorktreeId) return
    const groups = this.groupsOf(this.activeWorktreeId)
    const ids = groups[this.focusedGroup(this.activeWorktreeId)]?.ids ?? []
    if (ids.length < 2) return
    const i = ids.indexOf(this.focusedSessionId ?? '')
    const next = ids[wrapIndex(i, delta, ids.length)]
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
  /** Installed, non-disabled agents — the ones offered in the "+ agent" menu. */
  installedAgents(): ResolvedAgent[] {
    return this.availableAgents.filter(
      (a) => a.installed && !this.settings.disabledAgents.includes(a.id)
    )
  }
  // --- new-session picker (⌘T): Shell + installed agents, keyboard-navigable --
  /** Picker entries: a Shell option followed by each installed agent. */
  pickerItems(): Array<{ kind: 'shell' } | { kind: 'agent'; agent: ResolvedAgent }> {
    return [
      { kind: 'shell' },
      ...this.installedAgents().map((agent) => ({ kind: 'agent' as const, agent }))
    ]
  }
  /** Open the new-session picker for the active worktree (⌘T / toolbar +). */
  openPicker(): void {
    if (!this.activeWorktreeId) return
    this.pickerIndex = 0
    this.pickerOpen = true
    this.notify()
  }
  closePicker(): void {
    if (!this.pickerOpen) return
    this.pickerOpen = false
    this.notify()
  }
  /** Move the highlight (↑/↓/j/k), wrapping. */
  movePicker(delta: number): void {
    if (!this.pickerOpen) return
    const n = this.pickerItems().length
    if (n > 0) this.pickerIndex = wrapIndex(this.pickerIndex, delta, n)
    this.notify()
  }
  /** Open the selected entry (Enter / click) and close the picker. */
  confirmPicker(index = this.pickerIndex): void {
    const wt = this.activeWorktreeId
    const item = this.pickerItems()[index]
    this.closePicker()
    if (!wt || !item) return
    if (item.kind === 'shell') void this.addSession(wt, 'shell')
    else void this.addSession(wt, 'agent', item.agent)
  }
  private syncFocus(): void {
    const visible = new Set(
      this.activeWorktreeId ? this.sessionsOf(this.activeWorktreeId).map((s) => s.id) : []
    )
    if (this.focusedSessionId && !visible.has(this.focusedSessionId)) this.focusedSessionId = null
    if (!this.focusedSessionId && visible.size) this.focusedSessionId = [...visible][0]
    // Switching to a worktree (keyboard OR click) puts its panes on screen, so
    // clear their needs-attention highlight here too — focusSession already does
    // this on a direct click, but keyboard nav goes through syncFocus, which
    // previously left the sidebar block highlighted until a manual click.
    let cleared = false
    for (const { id } of this.visiblePanes()) if (this.pending.delete(id)) cleared = true
    if (cleared) this.syncBadge()
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
      this.syncBadge()
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
    // Apply optimistically + synchronously so controlled inputs (e.g. the folder
    // template) keep their caret. Previously this awaited the IPC save FIRST, so
    // the controlled value lagged a tick and the cursor jumped to the end on every
    // keystroke (and fast typing dropped chars).
    this.settings = { ...this.settings, ...patch }
    this.applyAppearance()
    // Font changes alter the cell size → re-fit visible panes (rows/cols change).
    if ('fontFamily' in patch || 'fontSize' in patch) this.fitVisible()
    this.notify()
    // Persist in the background. The local merge is authoritative — don't reassign
    // from the result, or an out-of-order save during fast typing would revert it.
    await window.api.settingsSave(patch)
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
      // Both html AND body must be cleared: the CSS `html, body { background:
      // var(--bg) }` rule otherwise leaves the root <html> painting an opaque
      // fill behind everything, so the window vibrancy never shows through.
      // Only the terminal is see-through (iTerm-style): html/body go transparent
      // so the panes can show the window vibrancy, and the pane container stays
      // transparent (the terminal canvas paints the single rgba tint). The chrome
      // — sidebar, tab bars, settings panel, dialogs — all use --panel/--panel-2,
      // which stay OPAQUE so the UI is solid and readable.
      root.style.background = 'transparent'
      document.body.style.background = 'transparent'
      root.style.setProperty('--pane-bg', 'transparent')
      root.style.setProperty('--panel', mix(s.background, '#ffffff', 0.06))
      root.style.setProperty('--panel-2', mix(s.background, '#ffffff', 0.11))
    } else {
      root.style.background = s.background
      document.body.style.background = s.background
      root.style.setProperty('--pane-bg', s.background)
      root.style.setProperty('--panel', mix(s.background, '#ffffff', 0.06))
      root.style.setProperty('--panel-2', mix(s.background, '#ffffff', 0.11))
    }
    // Apply theme + font to live terminals too. (Font changes also need a refit
    // since the cell size changes — updateSettings triggers fitVisible for that.)
    const font = this.terminalFont()
    for (const { term } of this.panes.values()) {
      try {
        term.options.allowTransparency = s.transparent
        term.options.theme = { background: termBg, foreground: s.foreground }
        term.options.fontFamily = font.fontFamily
        term.options.fontSize = font.fontSize
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
  /** Terminal font: the user's family first, then the bundled Nerd Font fallback
   * so box-drawing/agent glyphs always render. */
  terminalFont(): { fontFamily: string; fontSize: number } {
    const fam = this.settings.fontFamily?.trim()
    return {
      fontFamily: fam ? `"${fam}", ${FONT_FALLBACK}` : FONT_FALLBACK,
      fontSize: this.settings.fontSize || 13
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
      this.scheduleRepaint(id)
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
        // Grove in the background → the in-app toast/glow is invisible. Fire an OS
        // notification so the user is alerted while doing something else.
        if (!document.hasFocus()) window.api.notifyAttention(id, s.title)
        this.syncBadge()
      }
      this.notify()
    })
    window.api.onSessionExit(({ id, exitCode, signal }) => {
      const sess = this.sessions.get(id)
      if (!sess) return
      // A clean exit (the user typed `exit`, or the agent finished) auto-closes
      // the tab. A FAILED exit (non-zero code, or killed by a signal) used to
      // close just as silently — so a mis-launched agent (e.g. its CLI isn't on
      // the login-shell PATH, exit 127) looked like the tab "flashing away" with
      // no clue why. Instead, keep the tab open, mark it exited, and annotate the
      // pane so the shell's own error (printed just above) stays readable.
      const { failed, reason: why } = classifyExit(exitCode, signal)
      if (!failed) {
        this.closeSession(id)
        return
      }
      sess.state = 'exited'
      const term = this.panes.get(id)?.term
      term?.write(
        `\r\n\x1b[1;33m⚠ Session exited\x1b[0m \x1b[2m(${why}).\x1b[0m\r\n` +
          `\x1b[2mThe command above ended immediately. If it's "command not found", the agent CLI\r\n` +
          `isn't on the PATH of a login shell — add it in ~/.zshenv (not ~/.zshrc). ` +
          `Close this tab when done.\x1b[0m\r\n`
      )
      this.notify()
    })
    // A clicked OS notification: jump to the session that needs input.
    window.api.onNotifyJump(({ id }) => {
      const s = this.sessions.get(id)
      if (s) {
        this.activeProjectId = this.repoRootOf(s.worktreeId) ?? this.activeProjectId
        this.activeWorktreeId = s.worktreeId
        this.focusSession(id)
      }
    })
  }

  /** Reflect the pending (needs-attention) count on the Dock/taskbar badge. */
  private syncBadge(): void {
    window.api.setBadgeCount(this.pending.size)
  }

  async init(): Promise<void> {
    await document.fonts.load('13px "MesloLGS NF"').catch(() => {})
    await document.fonts.load('700 13px "MesloLGS NF"').catch(() => {})
    this.settings = await window.api.settingsLoad()
    this.applyAppearance()
    this.availableAgents = await window.api.agentsAvailable().catch(() => [])
    this.wireEvents()
    this.savedLayout = await window.api.layoutLoad()
    this.closedAgents = await window.api.closedAgentsLoad().catch(() => [])
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
    this.startMetaPolling()
    // Refocusing Grove (e.g. after creating a worktree in another terminal)
    // reconciles immediately, so it appears without waiting for the poll.
    window.addEventListener('focus', () => void this.reconcileAllWorktrees())
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
