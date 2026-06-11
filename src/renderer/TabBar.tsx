import { useState } from 'react'
import { useStore } from './useStore'
import { store } from './store'
import {
  AgentTabIcon,
  BellIcon,
  GearIcon,
  PlusIcon,
  SplitIcon,
  SingleIcon,
  ChevronDownIcon,
  ZoomIcon
} from './Icons'

/** The top bar: sidebar toggle on the left, global actions on the right.
 * Per-group session tabs live in <GroupTabs> (the row below). */
export function TabBar(): JSX.Element {
  const s = useStore()
  const split = s.isSplit()
  const agents = s.availableAgents.filter(
    (a) => a.installed && !s.settings.disabledAgents.includes(a.id)
  )
  const [menuOpen, setMenuOpen] = useState(false)
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
        {agents.length === 1 && (
          <button
            className="add-session"
            aria-label="New agent"
            disabled={!wt}
            onClick={() => wt && void store.addSession(wt, 'agent', agents[0])}
          >
            <PlusIcon size={12} /> agent
          </button>
        )}
        {agents.length > 1 && (
          <div className="agent-add">
            <button
              className="add-session"
              aria-label="New agent"
              disabled={!wt}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <PlusIcon size={12} /> agent <ChevronDownIcon size={12} />
            </button>
            {menuOpen && (
              <div className="agent-menu" onMouseLeave={() => setMenuOpen(false)}>
                {agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      setMenuOpen(false)
                      if (wt) void store.addSession(wt, 'agent', a)
                    }}
                  >
                    <AgentTabIcon icon={a.icon} size={14} /> {a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          className="add-session"
          aria-label="New shell"
          disabled={!wt}
          onClick={() => wt && void store.addSession(wt, 'shell')}
        >
          <PlusIcon size={12} /> shell
        </button>
        <button
          className="add-session"
          aria-label="Open file"
          disabled={!wt}
          onClick={() => wt && store.promptOpenFile(wt)}
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
