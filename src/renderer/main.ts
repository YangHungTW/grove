import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import type { SessionKind, SessionState } from '../core/types'
import type { SessionSnapshot } from '../main/ipc'

/**
 * Renderer: cmux-style shell.
 *  - Multiple worktrees in the sidebar, each expandable to its sessions.
 *  - The active worktree's sessions are tiled side-by-side (split panes), so
 *    you watch the agent + a shell + a server at once.
 */

interface WorktreeView {
  id: string // = path
  path: string
  branch: string
  primary: boolean // the repo's main worktree (cannot be removed)
}

interface Pane {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
}

const worktrees = new Map<string, WorktreeView>()
const sessions = new Map<string, SessionSnapshot>()
const panes = new Map<string, Pane>()
const pending = new Set<string>()
let activeWorktreeId: string | null = null
let focusedSessionId: string | null = null
let repoRoot = ''

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

function sessionsOf(worktreeId: string): SessionSnapshot[] {
  return [...sessions.values()].filter((s) => s.worktreeId === worktreeId)
}

// --- sidebar -------------------------------------------------------------
function renderSidebar(): void {
  sidebar.innerHTML = ''

  const newWt = document.createElement('button')
  newWt.className = 'new-worktree'
  newWt.textContent = '+ worktree'
  newWt.addEventListener('click', showNewWorktreeInput)
  sidebar.appendChild(newWt)

  for (const wt of worktrees.values()) {
    const header = document.createElement('div')
    header.className = 'wt-header' + (wt.id === activeWorktreeId ? ' active' : '')

    const title = document.createElement('button')
    title.className = 'wt-title'
    title.textContent = `▾ ${wt.branch || '(detached)'}${wt.primary ? ' ·main' : ''}`
    title.addEventListener('click', () => setActiveWorktree(wt.id))
    header.appendChild(title)

    if (!wt.primary) {
      const rm = document.createElement('button')
      rm.className = 'wt-remove'
      rm.textContent = '×'
      rm.title = 'remove worktree'
      rm.addEventListener('click', () => void removeWorktree(wt.id))
      header.appendChild(rm)
    }
    sidebar.appendChild(header)

    for (const s of sessionsOf(wt.id)) {
      const row = document.createElement('div')
      row.className = 'session-row'
      if (s.id === focusedSessionId) row.classList.add('active')
      if (pending.has(s.id)) row.classList.add('attention')

      const dot = document.createElement('span')
      dot.className = `dot dot-${s.state}`
      row.appendChild(dot)

      const label = document.createElement('button')
      label.className = 'session-label'
      label.textContent = `${s.kind === 'agent' ? '★ ' : ''}${s.title}`
      label.addEventListener('click', () => {
        setActiveWorktree(wt.id)
        focusSession(s.id)
      })
      row.appendChild(label)

      const close = document.createElement('button')
      close.className = 'session-close'
      close.textContent = '×'
      close.addEventListener('click', () => closeSession(s.id))
      row.appendChild(close)

      sidebar.appendChild(row)
    }

    const actions = document.createElement('div')
    actions.className = 'actions'
    for (const kind of ['agent', 'shell', 'server', 'task'] as const) {
      const btn = document.createElement('button')
      btn.textContent = `+ ${kind}`
      btn.addEventListener('click', () => void addSession(wt.id, kind))
      actions.appendChild(btn)
    }
    sidebar.appendChild(actions)
  }
}

function showNewWorktreeInput(): void {
  const existing = sidebar.querySelector('.wt-input') as HTMLInputElement | null
  if (existing) {
    existing.focus()
    return
  }
  const input = document.createElement('input')
  input.className = 'wt-input'
  input.placeholder = 'new branch name, Enter to create'
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      void createWorktree(input.value.trim())
    } else if (e.key === 'Escape') {
      renderSidebar()
    }
  })
  sidebar.insertBefore(input, sidebar.children[1] ?? null)
  input.focus()
}

// --- worktree ops --------------------------------------------------------
async function createWorktree(branch: string): Promise<void> {
  const path = `${repoRoot}-wt-${branch.replace(/[^\w.-]/g, '_')}`
  try {
    const info = await window.api.worktreeCreate(repoRoot, { path, branch, newBranch: true })
    worktrees.set(info.path, {
      id: info.path,
      path: info.path,
      branch: info.branch || branch,
      primary: false
    })
    setActiveWorktree(info.path)
  } catch (err) {
    notify(String(err))
    renderSidebar()
  }
}

async function removeWorktree(id: string): Promise<void> {
  const wt = worktrees.get(id)
  if (!wt || wt.primary) return
  for (const s of sessionsOf(id)) closeSession(s.id)
  try {
    await window.api.worktreeRemove({ repoRoot, path: wt.path, force: true })
  } catch (err) {
    notify(String(err))
  }
  worktrees.delete(id)
  if (activeWorktreeId === id) {
    const next = worktrees.keys().next().value ?? null
    activeWorktreeId = next
  }
  layoutPanes()
  renderSidebar()
}

// --- sessions ------------------------------------------------------------
async function addSession(worktreeId: string, kind: SessionKind): Promise<void> {
  const wt = worktrees.get(worktreeId)
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
    setActiveWorktree(worktreeId)
    focusSession(snap.id)
  } catch (err) {
    notify(String(err)) // single-agent invariant etc.
  }
}

function closeSession(id: string): void {
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
  layoutPanes()
  renderSidebar()
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

function setActiveWorktree(id: string): void {
  activeWorktreeId = id
  const visible = new Set(sessionsOf(id).map((s) => s.id))
  if (focusedSessionId && !visible.has(focusedSessionId)) focusedSessionId = null
  if (!focusedSessionId && visible.size) focusedSessionId = [...visible][0]
  layoutPanes()
  renderSidebar()
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

  for (const [id, pane] of panes) {
    pane.el.style.display = visible.includes(id) ? 'block' : 'none'
  }
  requestAnimationFrame(() => {
    for (const id of visible) {
      const pane = panes.get(id)
      if (!pane) continue
      pane.fit.fit()
      window.api.sessionResize(id, pane.term.cols, pane.term.rows)
    }
  })
}

function notify(message: string): void {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
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

window.addEventListener('resize', () => layoutPanes())
window.addEventListener('keydown', (e) => {
  if (e.metaKey && e.key.toLowerCase() === 't' && activeWorktreeId) {
    e.preventDefault()
    void addSession(activeWorktreeId, 'shell')
  }
})

// --- bootstrap -----------------------------------------------------------
async function init(): Promise<void> {
  repoRoot = await window.api.repoRoot()
  try {
    const list = await window.api.worktreeList(repoRoot)
    list.forEach((w, i) =>
      worktrees.set(w.path, {
        id: w.path,
        path: w.path,
        branch: w.branch,
        primary: i === 0 || w.path === repoRoot
      })
    )
  } catch {
    // Not a git repo — seed a single local worktree at the repo root.
    worktrees.set(repoRoot, { id: repoRoot, path: repoRoot, branch: 'local', primary: true })
  }
  if (worktrees.size === 0) {
    worktrees.set(repoRoot, { id: repoRoot, path: repoRoot, branch: 'local', primary: true })
  }
  activeWorktreeId = worktrees.keys().next().value ?? null
  renderSidebar()
}

void init()
