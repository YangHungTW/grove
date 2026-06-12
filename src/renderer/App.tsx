import { useEffect, type CSSProperties, type MouseEvent } from 'react'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { GroupTabs } from './GroupTabs'
import { PaneGrid } from './PaneGrid'
import { SettingsPanel } from './SettingsPanel'
import { Dialog } from './Dialog'
import { useStore } from './useStore'
import { store } from './store'
import { matchesAccel } from './keymatch'
import type { KeybindAction } from '../core/settings'

const KEYBIND_ACTIONS: Record<KeybindAction, () => void> = {
  splitToggle: () => store.toggleSplit(),
  newShell: () => store.newShellInActive(),
  closeSession: () => store.closeFocused(),
  nextSession: () => store.cycleSession(1),
  prevSession: () => store.cycleSession(-1),
  focusLeft: () => store.focusGroup(0),
  focusRight: () => store.focusGroup(1),
  moveToOtherGroup: () => store.moveFocusedToGroup(store.focusedGroup(store.activeWorktreeId ?? '') === 0 ? 1 : 0),
  renameTab: () => store.renameFocused(),
  toggleSidebar: () => store.toggleSidebar(),
  zoomPane: () => store.toggleZoom()
}

export function App(): JSX.Element {
  const s = useStore()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Never hijack keys mid IME composition (Chinese/Japanese/Korean input):
      // a composition keydown reports keyCode 229 / isComposing, and must reach
      // the terminal's textarea untouched.
      if (e.isComposing || e.keyCode === 229) return
      // Never hijack typing in our own inputs (settings, tab rename). The xterm
      // terminal uses a <textarea>, so terminal-focused shortcuts still work.
      if (e.target instanceof HTMLInputElement) return

      // Configurable shortcuts (default ⌃⇧, kitty-style) take priority.
      for (const [action, accel] of Object.entries(store.settings.keybindings)) {
        if (matchesAccel(e, accel)) {
          e.preventDefault()
          e.stopPropagation()
          KEYBIND_ACTIONS[action as KeybindAction]()
          return
        }
      }

      if (!e.metaKey) return
      const k = e.key.toLowerCase()
      if (e.shiftKey && k === 'u') {
        e.preventDefault()
        store.jumpToPending()
      } else if (e.shiftKey && e.code === 'BracketRight') {
        // ⌘⇧] — next tab. Match on e.code: with modifiers the bracket keys
        // report e.key '}'/'{' (and option-glyphs on macOS); e.code is stable.
        e.preventDefault()
        store.cycleSession(1)
      } else if (e.shiftKey && e.code === 'BracketLeft') {
        // ⌘⇧[ — previous tab.
        e.preventDefault()
        store.cycleSession(-1)
      } else if (e.shiftKey && (k === 'arrowdown' || k === 'j')) {
        // ⌘⇧↓ / ⌘⇧J — next worktree (vim down; worktrees stack vertically).
        e.preventDefault()
        store.cycleWorktree(1)
      } else if (e.shiftKey && (k === 'arrowup' || k === 'k')) {
        // ⌘⇧↑ / ⌘⇧K — previous worktree (vim up).
        e.preventDefault()
        store.cycleWorktree(-1)
      } else if (e.shiftKey && (k === 'arrowright' || k === 'l')) {
        // ⌘⇧→ / ⌘⇧L — next project (vim right).
        e.preventDefault()
        store.cycleProject(1)
      } else if (e.shiftKey && (k === 'arrowleft' || k === 'h')) {
        // ⌘⇧← / ⌘⇧H — previous project (vim left).
        e.preventDefault()
        store.cycleProject(-1)
      } else if (k === 'f') {
        // ⌘F — find in the focused terminal's scrollback.
        e.preventDefault()
        store.openSearch()
      } else if (k === 'b') {
        e.preventDefault()
        store.toggleSidebar()
      } else if (k === ',') {
        e.preventDefault()
        store.openSettings(true)
      } else if (k === 'd') {
        e.preventDefault()
        store.toggleSplit()
      } else if (k === 't' && store.activeWorktreeId) {
        e.preventDefault()
        void store.addSession(store.activeWorktreeId, 'shell')
      } else if (k === 'w' && store.focusedSessionId) {
        e.preventDefault()
        store.closeSession(store.focusedSessionId)
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const idx = Number(e.key) - 1
        if (e.altKey) void store.switchProject(idx)
        else store.switchWorktree(idx)
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  // A file dropped anywhere Grove doesn't explicitly handle would make Electron
  // navigate the window to that file (blanking the app). Swallow stray drag/drop
  // at the window level; the terminal panes + "file" button handle their own.
  useEffect(() => {
    const swallow = (e: globalThis.DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  const appStyle = {
    '--sidebar-w': `${s.settings.sidebarWidth || 248}px`
  } as CSSProperties

  return (
    <div
      id="app"
      className={s.settings.sidebarCollapsed ? 'sidebar-collapsed' : ''}
      style={appStyle}
    >
      {!s.settings.sidebarCollapsed && <Sidebar />}
      {!s.settings.sidebarCollapsed && <SidebarResizer />}
      <main id="content">
        <TabBar />
        <GroupTabs />
        <PaneGrid />
      </main>
      <SettingsPanel />
      <Dialog />
    </div>
  )
}

/** Drag handle on the sidebar's right edge. Updates the width live via the CSS
 * variable during the drag (cheap, no React churn) and persists it on release. */
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 560
function SidebarResizer(): JSX.Element {
  const onDown = (e: MouseEvent): void => {
    e.preventDefault()
    const app = document.getElementById('app')
    if (!app) return
    const startX = e.clientX
    const startW = store.settings.sidebarWidth || 248
    const widthAt = (ev: globalThis.MouseEvent): number =>
      Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + ev.clientX - startX))
    app.classList.add('resizing-sidebar')
    const onMove = (ev: globalThis.MouseEvent): void => {
      app.style.setProperty('--sidebar-w', `${widthAt(ev)}px`)
    }
    const onUp = (ev: globalThis.MouseEvent): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      app.classList.remove('resizing-sidebar')
      void store.updateSettings({ sidebarWidth: widthAt(ev) })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  return <div className="sidebar-resizer" onMouseDown={onDown} title="Drag to resize sidebar" />
}
