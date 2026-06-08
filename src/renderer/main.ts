import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import type { SessionKind, SessionState } from '../core/types'
import type { SessionSnapshot } from '../main/ipc'
import type { SessionDescriptor } from '../core/layoutStore'

/**
 * Renderer: cmux-style shell with a ccmanager-style hierarchy.
 *   Project (a git repo) → Worktree (branch) → Session (pty pane).
 *  - Open multiple projects (native dialog + persisted recent list).
 *  - Each project expands to its worktrees; each worktree to its sessions.
 *  - The active worktree's sessions are tiled side-by-side (split panes).
 */

interface WorktreeView {
  id: string // = path
  path: string
  branch: string
  primary: boolean
}

interface ProjectView {
  repoRoot: string // = id
  name: string
  expanded: boolean
  loaded: boolean
  worktrees: Map<string, WorktreeView>
}

interface Pane {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
}

const projects = new Map<string, ProjectView>()
const sessions = new Map<string, SessionSnapshot>()
const panes = new Map<string, Pane>()
const pending = new Set<string>()
let activeProjectId: string | null = null
let activeWorktreeId: string | null = null
let focusedSessionId: string | null = null

// Persistence: descriptors saved at launch; projects respawned lazily on select.
let savedLayout: SessionDescriptor[] = []
const restoredProjects = new Set<string>()
let restoring = false

// Split-pane sizing: per-column / per-row fractions for the active grid. Reset
// to equal whenever the grid shape (column/row count) changes.
let colFr: number[] = []
let rowFr: number[] = []

// cmux-style UX state.
const splitMode = new Map<string, boolean>() // worktreeId -> tile all vs single tab
const lastLine = new Map<string, string>() // sessionId -> latest output line
const wtStatus = new Map<string, { dirty: number; ahead: number; behind: number }>()

const sidebar = document.getElementById('sidebar') as HTMLElement
const panesRoot = document.getElementById('panes') as HTMLElement
const tabsEl = document.getElementById('tabs') as HTMLElement
const splitToggle = document.getElementById('split-toggle') as HTMLButtonElement
const notifBtn = document.getElementById('notif-btn') as HTMLButtonElement
const notifCount = document.getElementById('notif-count') as HTMLElement

const ANSI_RE = /\[[0-9;?]*[A-Za-z]|\][^]*|[()][AB0]/g
function lastNonEmptyLine(data: string): string | null {
  const lines = data.replace(ANSI_RE, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.length ? lines[lines.length - 1] : null
}

const sessionsOf = (worktreeId: string): SessionSnapshot[] =>
  [...sessions.values()].filter((s) => s.worktreeId === worktreeId)

const activeProject = (): ProjectView | undefined =>
  activeProjectId ? projects.get(activeProjectId) : undefined

function currentDescriptors(): SessionDescriptor[] {
  const out: SessionDescriptor[] = []
  for (const project of projects.values())
    for (const wt of project.worktrees.values())
      for (const s of sessionsOf(wt.id))
        out.push({ repoRoot: project.repoRoot, worktreePath: wt.path, kind: s.kind, title: s.title })
  return out
}

/** Save layout = live sessions + saved descriptors of not-yet-restored projects. */
function persistLayout(): void {
  if (restoring) return
  const keep = savedLayout.filter((d) => !restoredProjects.has(d.repoRoot))
  const merged = [...keep, ...currentDescriptors()]
  savedLayout = merged
  window.api.layoutSave(merged)
}

/** Respawn the persisted sessions of a project once its worktrees are loaded. */
async function restoreProject(project: ProjectView): Promise<void> {
  if (restoredProjects.has(project.repoRoot)) return
  restoredProjects.add(project.repoRoot)
  const toRestore = savedLayout.filter((d) => d.repoRoot === project.repoRoot)
  if (toRestore.length === 0) return
  restoring = true
  for (const d of toRestore) {
    const wt = [...project.worktrees.values()].find((w) => w.path === d.worktreePath)
    if (wt) await addSession(wt.id, d.kind)
  }
  restoring = false
  persistLayout()
}

// --- projects ------------------------------------------------------------
async function loadWorktrees(project: ProjectView): Promise<void> {
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
    /* not a git repo / transient — leave empty */
  }
  project.loaded = true
  // Fetch git status per worktree (async; refresh sidebar when each lands).
  for (const wt of project.worktrees.values()) {
    window.api
      .worktreeStatus(wt.path)
      .then((s) => {
        wtStatus.set(wt.id, s)
        renderSidebar()
      })
      .catch(() => {})
  }
}

async function openProject(): Promise<void> {
  try {
    const entry = await window.api.projectOpenDialog()
    if (!entry) return
    upsertProject(entry.repoRoot, entry.name)
    await setActiveProject(entry.repoRoot)
  } catch (err) {
    notify(errMsg(err))
  }
}

function upsertProject(repoRoot: string, name: string): ProjectView {
  let p = projects.get(repoRoot)
  if (!p) {
    p = { repoRoot, name, expanded: false, loaded: false, worktrees: new Map() }
    projects.set(repoRoot, p)
  }
  return p
}

async function removeProject(repoRoot: string): Promise<void> {
  for (const wt of projects.get(repoRoot)?.worktrees.values() ?? []) {
    for (const s of sessionsOf(wt.id)) closeSession(s.id, true)
  }
  await window.api.projectRemove(repoRoot)
  projects.delete(repoRoot)
  savedLayout = savedLayout.filter((d) => d.repoRoot !== repoRoot)
  restoredProjects.add(repoRoot) // its descriptors are gone; don't re-merge
  if (activeProjectId === repoRoot) {
    activeProjectId = projects.keys().next().value ?? null
    const p = activeProject()
    activeWorktreeId = p ? (p.worktrees.keys().next().value ?? null) : null
  }
  persistLayout()
  layoutPanes()
  renderSidebar()
}

async function setActiveProject(repoRoot: string): Promise<void> {
  const p = projects.get(repoRoot)
  if (!p) return
  activeProjectId = repoRoot
  for (const other of projects.values()) other.expanded = other.repoRoot === repoRoot
  if (!p.loaded) await loadWorktrees(p)
  await restoreProject(p)
  activeWorktreeId = p.worktrees.keys().next().value ?? null
  syncFocus()
  layoutPanes()
  renderSidebar()
}

// --- worktrees -----------------------------------------------------------
async function createWorktree(project: ProjectView, branch: string): Promise<void> {
  const path = `${project.repoRoot}-wt-${branch.replace(/[^\w.-]/g, '_')}`
  try {
    const info = await window.api.worktreeCreate(project.repoRoot, {
      path,
      branch,
      newBranch: true
    })
    project.worktrees.set(info.path, {
      id: info.path,
      path: info.path,
      branch: info.branch || branch,
      primary: false
    })
    activeProjectId = project.repoRoot
    activeWorktreeId = info.path
    syncFocus()
    layoutPanes()
    renderSidebar()
  } catch (err) {
    notify(errMsg(err))
    renderSidebar()
  }
}

async function removeWorktree(project: ProjectView, wtId: string): Promise<void> {
  const wt = project.worktrees.get(wtId)
  if (!wt || wt.primary) return
  for (const s of sessionsOf(wtId)) closeSession(s.id, true)
  try {
    await window.api.worktreeRemove({ repoRoot: project.repoRoot, path: wt.path, force: true })
  } catch (err) {
    notify(errMsg(err))
  }
  project.worktrees.delete(wtId)
  if (activeWorktreeId === wtId) activeWorktreeId = project.worktrees.keys().next().value ?? null
  persistLayout()
  layoutPanes()
  renderSidebar()
}

// --- sessions ------------------------------------------------------------
async function addSession(worktreeId: string, kind: SessionKind): Promise<void> {
  const wt = activeProject()?.worktrees.get(worktreeId)
  if (!wt) return

  // Number duplicates so multiple agents/shells are distinguishable.
  const n = sessionsOf(worktreeId).filter((s) => s.kind === kind).length
  const title = n === 0 ? kind : `${kind} ${n + 1}`
  const agent = kind === 'agent' ? 'claude' : undefined

  try {
    const snap = await window.api.sessionCreate({
      worktreeId,
      kind,
      command: kind, // placeholder — main launches $SHELL -il for every session
      agent,
      cwd: wt.path,
      title
    })
    sessions.set(snap.id, snap)
    mountPane(snap)
    activeWorktreeId = worktreeId
    focusSession(snap.id) // sets focus + lays out/fits the new pane
    persistLayout()
  } catch (err) {
    notify(errMsg(err)) // single-agent invariant etc.
  }
}

function closeSession(id: string, quiet = false): void {
  window.api.sessionKill(id)
  const pane = panes.get(id)
  if (pane) {
    pane.term.dispose()
    pane.el.remove()
    panes.delete(id)
  }
  sessions.delete(id)
  pending.delete(id)
  if (focusedSessionId === id) focusedSessionId = null
  if (!quiet) {
    persistLayout()
    layoutPanes()
    renderSidebar()
  }
}

function mountPane(snap: SessionSnapshot): void {
  const el = document.createElement('div')
  el.className = 'pane'
  el.dataset.sessionId = snap.id
  el.addEventListener('mousedown', () => focusSession(snap.id))
  panesRoot.appendChild(el)

  const term = new Terminal({
    convertEol: true,
    fontSize: 13,
    // Prefer a Nerd Font (powerlevel10k's recommended MesloLGS NF) so powerline
    // glyphs render; fall back to system monospace.
    fontFamily: '"MesloLGS NF", "MesloLGS Nerd Font", Menlo, Monaco, "Courier New", monospace',
    cursorBlink: true
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(el)
  term.onData((data) => window.api.sessionInput(snap.id, data))

  panes.set(snap.id, { term, fit, el })
}

function syncFocus(): void {
  const visible = new Set(activeWorktreeId ? sessionsOf(activeWorktreeId).map((s) => s.id) : [])
  if (focusedSessionId && !visible.has(focusedSessionId)) focusedSessionId = null
  if (!focusedSessionId && visible.size) focusedSessionId = [...visible][0]
}

function focusSession(id: string): void {
  focusedSessionId = id
  pending.delete(id)
  layoutPanes() // single mode: makes this the visible pane; also refits + tabs
  const pane = panes.get(id)
  if (pane) {
    panesRoot.querySelectorAll('.pane').forEach((p) => p.classList.toggle('focused', p === pane.el))
    pane.term.focus()
  }
  renderSidebar()
  updateNotif()
}

// --- tabs / toolbar / notifications (cmux-style) -------------------------
function renderTabs(): void {
  tabsEl.innerHTML = ''
  if (!activeWorktreeId) return
  for (const s of sessionsOf(activeWorktreeId)) {
    const tab = el('button', 'tab' + (s.id === focusedSessionId ? ' active' : ''))
    if (pending.has(s.id)) tab.classList.add('attention')
    tab.appendChild(el('span', `dot dot-${s.state}`))
    tab.appendChild(el('span', 'tab-title', `${s.kind === 'agent' ? '★ ' : ''}${s.title}`))
    tab.addEventListener('click', () => focusSession(s.id))
    const x = el('button', 'tab-x', '×')
    x.addEventListener('click', (e) => {
      e.stopPropagation()
      closeSession(s.id)
    })
    tab.appendChild(x)
    tabsEl.appendChild(tab)
  }
}

function updateToolbar(): void {
  const split = activeWorktreeId ? !!splitMode.get(activeWorktreeId) : false
  splitToggle.textContent = split ? '◳ single' : '⊟ split'
  splitToggle.classList.toggle('active', split)
}

function toggleSplit(): void {
  if (!activeWorktreeId) return
  splitMode.set(activeWorktreeId, !splitMode.get(activeWorktreeId))
  layoutPanes()
}

function updateNotif(): void {
  notifCount.textContent = pending.size ? String(pending.size) : ''
  notifBtn.classList.toggle('active', pending.size > 0)
}

/** Jump to the most recent session needing attention (⌘⇧U / bell button). */
function jumpToPending(): void {
  const ids = [...pending]
  if (!ids.length) return
  const id = ids[ids.length - 1]
  const s = sessions.get(id)
  if (!s) {
    pending.delete(id)
    return
  }
  for (const p of projects.values())
    for (const wt of p.worktrees.values())
      if (wt.id === s.worktreeId) {
        activeProjectId = p.repoRoot
        for (const o of projects.values()) o.expanded = o.repoRoot === p.repoRoot
        activeWorktreeId = wt.id
      }
  focusSession(id)
}

/** Which session panes are shown: all (split) or just the focused one (single). */
function visibleSessions(): string[] {
  if (!activeWorktreeId) return []
  const all = sessionsOf(activeWorktreeId).map((s) => s.id)
  if (splitMode.get(activeWorktreeId)) return all
  if (focusedSessionId && all.includes(focusedSessionId)) return [focusedSessionId]
  return all.slice(0, 1)
}

/** Lay out the visible panes (single focused, or tiled when split mode is on). */
function layoutPanes(): void {
  const visible = visibleSessions()
  const n = Math.max(visible.length, 1)
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  if (colFr.length !== cols) colFr = Array(cols).fill(1)
  if (rowFr.length !== rows) rowFr = Array(rows).fill(1)
  applyGridTemplate()
  for (const [id, pane] of panes) pane.el.style.display = visible.includes(id) ? 'block' : 'none'
  renderGutters(cols, rows)
  fitVisible(visible)
  renderTabs()
  updateToolbar()
}

function applyGridTemplate(): void {
  panesRoot.style.gridTemplateColumns = colFr.map((f) => `${f}fr`).join(' ')
  panesRoot.style.gridTemplateRows = rowFr.map((f) => `${f}fr`).join(' ')
}

let prevVisible: string[] = []

function fitVisible(visible: string[]): void {
  const newlyShown = visible.filter((id) => !prevVisible.includes(id))
  prevVisible = visible.slice()
  requestAnimationFrame(() => {
    for (const id of visible) {
      const pane = panes.get(id)
      if (!pane) continue
      pane.fit.fit()
      const { cols, rows } = pane.term
      window.api.sessionResize(id, cols, rows)
      // A pane that was hidden (display:none) loses its rendered canvas. Full
      // screen TUI agents (claude) only repaint on SIGWINCH, so nudge the size
      // on reshow to force a redraw — otherwise the pane looks blank ("gone").
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

/** Draggable dividers between columns/rows of the active worktree's pane grid. */
function renderGutters(cols: number, rows: number): void {
  panesRoot.querySelectorAll('.gutter').forEach((g) => g.remove())
  const w = panesRoot.clientWidth
  const h = panesRoot.clientHeight

  const ctot = colFr.reduce((a, b) => a + b, 0)
  let acc = 0
  for (let i = 0; i < cols - 1; i++) {
    acc += colFr[i]
    const g = el('div', 'gutter gutter-col')
    g.style.left = `${(w * acc) / ctot - 3}px`
    g.addEventListener('mousedown', (e) => startDrag(e, 'col', i, g))
    panesRoot.appendChild(g)
  }
  const rtot = rowFr.reduce((a, b) => a + b, 0)
  acc = 0
  for (let i = 0; i < rows - 1; i++) {
    acc += rowFr[i]
    const g = el('div', 'gutter gutter-row')
    g.style.top = `${(h * acc) / rtot - 3}px`
    g.addEventListener('mousedown', (e) => startDrag(e, 'row', i, g))
    panesRoot.appendChild(g)
  }
}

function startDrag(e: MouseEvent, axis: 'col' | 'row', i: number, handle: HTMLElement): void {
  e.preventDefault()
  const isCol = axis === 'col'
  const fr = isCol ? colFr : rowFr
  const rect = panesRoot.getBoundingClientRect()
  const size = isCol ? rect.width : rect.height
  const tot = fr.reduce((a, b) => a + b, 0)
  const pxPerFr = size / tot
  const start = isCol ? e.clientX : e.clientY
  const a0 = fr[i]
  const b0 = fr[i + 1]
  const min = 0.15

  const onMove = (ev: MouseEvent): void => {
    let d = ((isCol ? ev.clientX : ev.clientY) - start) / pxPerFr
    d = Math.max(-(a0 - min), Math.min(b0 - min, d))
    fr[i] = a0 + d
    fr[i + 1] = b0 - d
    applyGridTemplate()
    const pos = (isCol ? ev.clientX - rect.left : ev.clientY - rect.top) - 3
    if (isCol) handle.style.left = `${pos}px`
    else handle.style.top = `${pos}px`
  }
  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    layoutPanes() // reposition gutters precisely + refit terminals
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// --- sidebar -------------------------------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function renderSidebar(): void {
  sidebar.innerHTML = ''

  const open = el('button', 'new-project', '+ Open project…')
  open.addEventListener('click', () => void openProject())
  sidebar.appendChild(open)
  sidebar.appendChild(el('div', 'section-label', 'Projects'))

  for (const project of projects.values()) {
    const isActiveProject = project.repoRoot === activeProjectId
    const block = el('div', 'project' + (isActiveProject ? ' active' : ''))
    sidebar.appendChild(block)

    const head = el('div', 'project-header' + (isActiveProject ? ' active' : ''))
    const title = el('button', 'project-title', `${project.expanded ? '▾' : '▸'} ${project.name}`)
    title.addEventListener('click', () => void setActiveProject(project.repoRoot))
    head.appendChild(title)
    const rmP = el('button', 'row-x', '×')
    rmP.title = 'remove from recent'
    rmP.addEventListener('click', (e) => {
      e.stopPropagation()
      void removeProject(project.repoRoot)
    })
    head.appendChild(rmP)
    block.appendChild(head)

    if (!project.expanded) continue

    for (const wt of project.worktrees.values()) {
      const isActiveWt = project.repoRoot === activeProjectId && wt.id === activeWorktreeId
      const wtHead = el('div', 'wt-header' + (isActiveWt ? ' active' : ''))
      const wtTitle = el('button', 'wt-title', `▾ ${wt.branch || '(detached)'}${wt.primary ? ' ·main' : ''}`)
      wtTitle.addEventListener('click', () => {
        activeProjectId = project.repoRoot
        activeWorktreeId = wt.id
        syncFocus()
        layoutPanes()
        renderSidebar()
      })
      wtHead.appendChild(wtTitle)
      const st = wtStatus.get(wt.id)
      if (st && (st.dirty || st.ahead || st.behind)) {
        const parts: string[] = []
        if (st.dirty) parts.push(`●${st.dirty}`)
        if (st.ahead) parts.push(`↑${st.ahead}`)
        if (st.behind) parts.push(`↓${st.behind}`)
        wtHead.appendChild(el('span', 'wt-status', parts.join(' ')))
      }
      if (!wt.primary) {
        const rm = el('button', 'row-x', '×')
        rm.title = 'remove worktree'
        rm.addEventListener('click', (e) => {
          e.stopPropagation()
          void removeWorktree(project, wt.id)
        })
        wtHead.appendChild(rm)
      }
      block.appendChild(wtHead)

      if (!isActiveWt) continue

      for (const s of sessionsOf(wt.id)) {
        const row = el('div', 'session-row' + (s.id === focusedSessionId ? ' active' : ''))
        if (pending.has(s.id)) row.classList.add('attention')

        const top = el('div', 'session-top')
        top.appendChild(el('span', `dot dot-${s.state}`))
        const label = el('button', 'session-label', `${s.kind === 'agent' ? '★ ' : ''}${s.title}`)
        label.addEventListener('click', () => focusSession(s.id))
        top.appendChild(label)
        top.appendChild(el('span', 'session-state', s.state))
        const close = el('button', 'row-x', '×')
        close.addEventListener('click', () => closeSession(s.id))
        top.appendChild(close)
        row.appendChild(top)

        const line = lastLine.get(s.id)
        if (line) row.appendChild(el('div', 'session-line', line))
        block.appendChild(row)
      }

      const actions = el('div', 'actions')
      for (const kind of ['agent', 'shell'] as const) {
        const btn = el('button', '', `+ ${kind}`)
        btn.addEventListener('click', () => void addSession(wt.id, kind))
        actions.appendChild(btn)
      }
      block.appendChild(actions)
    }

    const newWt = el('button', 'new-worktree', '+ worktree')
    newWt.addEventListener('click', () => showWorktreeInput(project, newWt))
    block.appendChild(newWt)
  }
}

function showWorktreeInput(project: ProjectView, anchor: HTMLElement): void {
  const input = el('input', 'wt-input')
  input.placeholder = 'new branch name, Enter to create'
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) void createWorktree(project, input.value.trim())
    else if (e.key === 'Escape') renderSidebar()
  })
  anchor.replaceWith(input)
  input.focus()
}

/** Strip Electron's "Error invoking remote method '…':" / "FooError:" noise. */
function errMsg(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(/^Error: Error invoking remote method '[^']*':\s*/, '')
    .replace(/^\w*Error:\s*/, '')
}

function notify(message: string): void {
  const node = el('div', 'toast', message)
  document.body.appendChild(node)
  setTimeout(() => node.remove(), 4000)
}

// --- main-process events -------------------------------------------------
let lineRefreshScheduled = false
window.api.onSessionData(({ id, data }) => {
  panes.get(id)?.term.write(data)
  const line = lastNonEmptyLine(data)
  if (line) {
    lastLine.set(id, line)
    if (!lineRefreshScheduled) {
      lineRefreshScheduled = true
      setTimeout(() => {
        lineRefreshScheduled = false
        renderSidebar()
      }, 600)
    }
  }
})
window.api.onSessionState(({ id, state }) => {
  const s = sessions.get(id)
  if (!s) return
  s.state = state
  if ((state as SessionState) === 'waiting' && id !== focusedSessionId) {
    pending.add(id)
    notify(`${s.title} needs your attention`)
  }
  renderSidebar()
  renderTabs()
  updateNotif()
})
window.api.onSessionExit(({ id }) => {
  const s = sessions.get(id)
  if (s) s.state = 'exited'
  pending.delete(id)
  renderSidebar()
  renderTabs()
  updateNotif()
})

function switchWorktree(index: number): void {
  const p = activeProject()
  if (!p) return
  const wt = [...p.worktrees.values()][index]
  if (!wt) return
  activeWorktreeId = wt.id
  syncFocus()
  layoutPanes()
  renderSidebar()
}

async function switchProject(index: number): Promise<void> {
  const p = [...projects.values()][index]
  if (p) await setActiveProject(p.repoRoot)
}

splitToggle.addEventListener('click', toggleSplit)
notifBtn.addEventListener('click', jumpToPending)

window.addEventListener('resize', () => layoutPanes())
window.addEventListener('keydown', (e) => {
  if (!e.metaKey) return
  const k = e.key.toLowerCase()
  if (e.shiftKey && k === 'u') {
    e.preventDefault()
    jumpToPending()
  } else if (k === 'd') {
    e.preventDefault()
    toggleSplit()
  } else if (k === 't' && activeWorktreeId) {
    e.preventDefault()
    void addSession(activeWorktreeId, 'shell')
  } else if (k === 'w' && focusedSessionId) {
    e.preventDefault()
    closeSession(focusedSessionId)
  } else if (/^[1-9]$/.test(e.key)) {
    e.preventDefault()
    const idx = Number(e.key) - 1
    if (e.altKey) void switchProject(idx)
    else switchWorktree(idx)
  }
})

// --- bootstrap -----------------------------------------------------------
async function init(): Promise<void> {
  savedLayout = await window.api.layoutLoad()
  const recent = await window.api.projectListRecent()
  for (const p of recent) upsertProject(p.repoRoot, p.name)

  // Ensure the launched repo is present + selectable.
  const launched = await window.api.repoRoot()
  try {
    const entry = await window.api.projectAdd(launched)
    upsertProject(entry.repoRoot, entry.name)
  } catch {
    /* launched dir is not a git repo — skip auto-add */
  }

  const first = projects.keys().next().value as string | undefined
  if (first) await setActiveProject(first)
  else renderSidebar()
}

void init()
