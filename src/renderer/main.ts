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

const sidebar = document.getElementById('sidebar') as HTMLElement
const panesRoot = document.getElementById('panes') as HTMLElement

function commandFor(kind: SessionKind): { command: string; args?: string[]; agent?: string } {
  switch (kind) {
    case 'agent':
      return { command: 'claude', agent: 'claude' }
    case 'server':
      return { command: 'bash', args: ['-lc', 'echo "dev server pane"; exec bash'] }
    case 'task':
      return { command: 'bash', args: ['-lc', 'echo "task pane"; exec bash'] }
    case 'shell':
    default:
      return { command: 'bash' }
  }
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
}

async function openProject(): Promise<void> {
  try {
    const entry = await window.api.projectOpenDialog()
    if (!entry) return
    upsertProject(entry.repoRoot, entry.name)
    await setActiveProject(entry.repoRoot)
  } catch (err) {
    notify(String(err))
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
    notify(String(err))
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
    notify(String(err))
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
  const { command, args, agent } = commandFor(kind)
  try {
    const snap = await window.api.sessionCreate({
      worktreeId,
      kind,
      command,
      args,
      agent,
      cwd: wt.path,
      title: kind
    })
    sessions.set(snap.id, snap)
    mountPane(snap)
    activeWorktreeId = worktreeId
    layoutPanes() // size/fit the new pane to fill its cell (else xterm stays 24 rows)
    focusSession(snap.id)
    persistLayout()
  } catch (err) {
    notify(String(err)) // single-agent invariant etc.
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

  const term = new Terminal({ convertEol: true, fontSize: 13, cursorBlink: true })
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
  panesRoot.querySelectorAll('.pane').forEach((p) => p.classList.remove('focused'))
  const pane = panes.get(id)
  if (pane) {
    pane.el.classList.add('focused')
    pane.term.focus()
  }
  pending.delete(id)
  renderSidebar()
}

/** Tile every session of the active worktree side-by-side; hide the rest. */
function layoutPanes(): void {
  const visible = activeWorktreeId ? sessionsOf(activeWorktreeId).map((s) => s.id) : []
  const cols = Math.ceil(Math.sqrt(Math.max(visible.length, 1)))
  panesRoot.style.gridTemplateColumns = `repeat(${cols}, 1fr)`
  for (const [id, pane] of panes) pane.el.style.display = visible.includes(id) ? 'block' : 'none'
  requestAnimationFrame(() => {
    for (const id of visible) {
      const pane = panes.get(id)
      if (!pane) continue
      pane.fit.fit()
      window.api.sessionResize(id, pane.term.cols, pane.term.rows)
    }
  })
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
        row.appendChild(el('span', `dot dot-${s.state}`))
        const label = el('button', 'session-label', `${s.kind === 'agent' ? '★ ' : ''}${s.title}`)
        label.addEventListener('click', () => focusSession(s.id))
        row.appendChild(label)
        const close = el('button', 'row-x', '×')
        close.addEventListener('click', () => closeSession(s.id))
        row.appendChild(close)
        block.appendChild(row)
      }

      const actions = el('div', 'actions')
      for (const kind of ['agent', 'shell', 'server', 'task'] as const) {
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

function notify(message: string): void {
  const node = el('div', 'toast', message)
  document.body.appendChild(node)
  setTimeout(() => node.remove(), 4000)
}

// --- main-process events -------------------------------------------------
window.api.onSessionData(({ id, data }) => panes.get(id)?.term.write(data))
window.api.onSessionState(({ id, state }) => {
  const s = sessions.get(id)
  if (!s) return
  s.state = state
  if ((state as SessionState) === 'waiting' && id !== focusedSessionId) {
    pending.add(id)
    notify(`${s.title} needs your attention`)
  }
  renderSidebar()
})
window.api.onSessionExit(({ id }) => {
  const s = sessions.get(id)
  if (s) s.state = 'exited'
  renderSidebar()
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

window.addEventListener('resize', () => layoutPanes())
window.addEventListener('keydown', (e) => {
  if (!e.metaKey) return
  const k = e.key.toLowerCase()
  if (k === 't' && activeWorktreeId) {
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
