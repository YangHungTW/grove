import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import type { SessionKind, SessionState } from '../core/types'
import type { SessionSnapshot } from '../main/ipc'

/**
 * Renderer: a cmux-style shell. One default worktree hosts multiple sessions;
 * the sidebar lists them with state dots, the main area shows the active
 * terminal. This is the UI layer over the main-process engine.
 */

const WORKTREE_ID = 'local'

interface Pane {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
}

const sessions = new Map<string, SessionSnapshot>()
const panes = new Map<string, Pane>()
const pending = new Set<string>() // sessions in 'waiting' (need attention)
let activeId: string | null = null

const sidebar = document.getElementById('sidebar') as HTMLElement
const panesRoot = document.getElementById('panes') as HTMLElement

/** Default command per kind. Agents get state detection wired in main. */
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

function dotClass(state: SessionState): string {
  return `dot dot-${state}`
}

function renderSidebar(): void {
  sidebar.innerHTML = ''

  const header = document.createElement('div')
  header.className = 'wt-header'
  header.textContent = `▾ worktree: ${WORKTREE_ID}`
  sidebar.appendChild(header)

  for (const s of sessions.values()) {
    const row = document.createElement('button')
    row.className = 'session-row' + (s.id === activeId ? ' active' : '')
    if (pending.has(s.id)) row.classList.add('attention')

    const dot = document.createElement('span')
    dot.className = dotClass(s.state)
    row.appendChild(dot)

    const label = document.createElement('span')
    label.textContent = `${s.kind === 'agent' ? '★ ' : ''}${s.title}`
    row.appendChild(label)

    row.addEventListener('click', () => selectSession(s.id))
    sidebar.appendChild(row)
  }

  const actions = document.createElement('div')
  actions.className = 'actions'
  for (const kind of ['agent', 'shell', 'server', 'task'] as const) {
    const btn = document.createElement('button')
    btn.textContent = `+ ${kind}`
    btn.addEventListener('click', () => void addSession(kind))
    actions.appendChild(btn)
  }
  sidebar.appendChild(actions)
}

async function addSession(kind: SessionKind): Promise<void> {
  const { command, args, agent } = commandFor(kind)
  try {
    const snap = await window.api.sessionCreate({
      worktreeId: WORKTREE_ID,
      kind,
      command,
      args,
      agent,
      title: kind
    })
    sessions.set(snap.id, snap)
    mountPane(snap)
    selectSession(snap.id)
    renderSidebar()
  } catch (err) {
    // Single-agent invariant violation surfaces here.
    notify(String(err))
  }
}

function mountPane(snap: SessionSnapshot): void {
  const el = document.createElement('div')
  el.className = 'pane'
  el.style.display = 'none'
  panesRoot.appendChild(el)

  const term = new Terminal({ convertEol: true, fontSize: 13, cursorBlink: true })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(el)
  term.onData((data) => window.api.sessionInput(snap.id, data))

  panes.set(snap.id, { term, fit, el })
}

function selectSession(id: string): void {
  activeId = id
  for (const [sid, pane] of panes) {
    pane.el.style.display = sid === id ? 'block' : 'none'
  }
  pending.delete(id)
  const pane = panes.get(id)
  if (pane) {
    pane.fit.fit()
    pane.term.focus()
    window.api.sessionResize(id, pane.term.cols, pane.term.rows)
  }
  renderSidebar()
}

function notify(message: string): void {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

// --- main-process events -------------------------------------------------
window.api.onSessionData(({ id, data }) => {
  panes.get(id)?.term.write(data)
})

window.api.onSessionState(({ id, state }) => {
  const s = sessions.get(id)
  if (!s) return
  s.state = state
  if (state === 'waiting' && id !== activeId) {
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

window.addEventListener('resize', () => {
  if (activeId) panes.get(activeId)?.fit.fit()
})

// keyboard: ⌘T new shell in current worktree
window.addEventListener('keydown', (e) => {
  if (e.metaKey && e.key.toLowerCase() === 't') {
    e.preventDefault()
    void addSession('shell')
  }
})

renderSidebar()
