import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { PaneGrid } from './PaneGrid'
import { store } from './store'

export function App(): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey) return
      const k = e.key.toLowerCase()
      if (e.shiftKey && k === 'u') {
        e.preventDefault()
        store.jumpToPending()
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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div id="app">
      <Sidebar />
      <main id="content">
        <TabBar />
        <PaneGrid />
      </main>
    </div>
  )
}
