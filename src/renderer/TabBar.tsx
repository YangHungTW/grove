import { useState } from 'react'
import { useStore } from './useStore'
import { store } from './store'
import { filePathsFrom } from './fileDrop'
import { BellIcon, GearIcon, PlusIcon, SplitIcon, SingleIcon, ZoomIcon } from './Icons'

/** The top bar: sidebar toggle on the left, global actions on the right.
 * Per-group session tabs live in <GroupTabs> (the row below). */
export function TabBar(): JSX.Element {
  const s = useStore()
  const split = s.isSplit()
  const [fileDragOver, setFileDragOver] = useState(false)
  const wt = s.activeWorktreeId

  return (
    <div id="tabbar">
      <button
        id="sidebar-toggle"
        aria-label="Toggle sidebar"
        title={(s.settings.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar') + ' (⌘B)'}
        onClick={() => store.toggleSidebar()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.6" />
          <line x1="6" y1="2.5" x2="6" y2="13.5" />
          <rect x="1.5" y="2.5" width="4.5" height="11" rx="1.6" fill="currentColor" opacity="0.5" stroke="none" />
        </svg>
      </button>
      <div id="topbar-spacer" />
      <div id="toolbar">
        <button
          className="add-session"
          aria-label="New session"
          title="New session — shell or agent (⌘T)"
          disabled={!wt}
          onClick={() => store.openPicker()}
        >
          <PlusIcon size={12} /> new
        </button>
        <button
          className={'add-session' + (fileDragOver ? ' drag-over' : '')}
          aria-label="Open file"
          disabled={!wt}
          title="Open a file in a viewer pane — or drop a file here"
          onClick={() => wt && store.promptOpenFile(wt)}
          onDragOver={(e) => {
            if (wt && e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              setFileDragOver(true)
            }
          }}
          onDragLeave={() => setFileDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setFileDragOver(false)
            const [path] = wt ? filePathsFrom(e.dataTransfer) : []
            if (path) void store.openFile(wt!, path)
          }}
        >
          <PlusIcon size={12} /> file
        </button>
        <span className="toolbar-sep" />
        <button
          id="split-toggle"
          className={'icon-btn' + (split ? ' active' : '')}
          aria-label="Toggle split"
          title={split ? 'Merge groups' : 'Split right'}
          onClick={() => store.toggleSplit()}
        >
          {split ? <SingleIcon size={15} /> : <SplitIcon size={15} />}
        </button>
        <button
          id="zoom-toggle"
          className={'icon-btn' + (s.isZoomed() ? ' active' : '')}
          aria-label="Zoom pane"
          title={(s.isZoomed() ? 'Unzoom pane' : 'Zoom pane') + ` (${s.settings.keybindings.zoomPane})`}
          disabled={!s.focusedSessionId}
          onClick={() => store.toggleZoom()}
        >
          <ZoomIcon size={15} />
        </button>
        <button
          id="notif-btn"
          className={'icon-btn' + (s.pending.size > 0 ? ' active' : '')}
          aria-label="Notifications"
          title="Notifications (⌘⇧U)"
          onClick={() => store.jumpToPending()}
        >
          <BellIcon size={15} />
          {s.pending.size > 0 && <span id="notif-count">{s.pending.size}</span>}
        </button>
        <button
          className="icon-btn"
          aria-label="Settings"
          title="Settings"
          onClick={() => store.openSettings(true)}
        >
          <GearIcon size={15} />
        </button>
      </div>
    </div>
  )
}
