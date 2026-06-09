import { useEffect } from 'react'
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
  toggleSidebar: () => store.toggleSidebar()
}

export function App(): JSX.Element {
  const s = useStore()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
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

  return (
    <div id="app" className={s.settings.sidebarCollapsed ? 'sidebar-collapsed' : ''}>
      {!s.settings.sidebarCollapsed && <Sidebar />}
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
