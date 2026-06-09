import { useState } from 'react'
import { useStore } from './useStore'
import { store } from './store'

export function TabBar(): JSX.Element {
  const s = useStore()
  const sessions = s.activeWorktreeId ? s.sessionsOf(s.activeWorktreeId) : []
  const split = s.isSplit()
  // Installed agents the user hasn't turned off.
  const agents = s.availableAgents.filter(
    (a) => a.installed && !s.settings.disabledAgents.includes(a.id)
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const wt = s.activeWorktreeId

  const commitRename = (id: string): void => {
    store.renameSession(id, draft)
    setEditing(null)
  }

  return (
    <div id="tabbar">
      <button
        id="sidebar-toggle"
        title={(s.settings.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar') + ' (⌘B)'}
        onClick={() => store.toggleSidebar()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.6" />
          <line x1="6" y1="2.5" x2="6" y2="13.5" />
          <rect x="1.5" y="2.5" width="4.5" height="11" rx="1.6" fill="currentColor" opacity="0.5" stroke="none" />
        </svg>
      </button>
      <div id="tabs">
        {sessions.map((sess) =>
          editing === sess.id ? (
            <div key={sess.id} className="tab active">
              <input
                className="tab-rename"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(sess.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(sess.id)
                  else if (e.key === 'Escape') setEditing(null)
                }}
              />
            </div>
          ) : (
            <button
              key={sess.id}
              className={
                'tab' +
                (sess.id === s.focusedSessionId ? ' active' : '') +
                (s.pending.has(sess.id) ? ' attention' : '')
              }
              title="Double-click to rename"
              onClick={() => store.focusSession(sess.id)}
              onDoubleClick={() => {
                setEditing(sess.id)
                setDraft(sess.title)
              }}
            >
              <span className={`dot dot-${sess.state}`} />
              <span className="tab-title">
                {sess.icon ? sess.icon + ' ' : ''}
                {sess.title}
              </span>
              <button
                className="tab-x"
                onClick={(e) => {
                  e.stopPropagation()
                  store.closeSession(sess.id)
                }}
              >
                ×
              </button>
            </button>
          )
        )}
      </div>
      <div id="toolbar">
        {agents.length === 1 && (
          <button
            className="add-session"
            disabled={!wt}
            onClick={() => wt && void store.addSession(wt, 'agent', agents[0])}
          >
            + agent
          </button>
        )}
        {agents.length > 1 && (
          <div className="agent-add">
            <button className="add-session" disabled={!wt} onClick={() => setMenuOpen((o) => !o)}>
              + agent ▾
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
                    {a.icon} {a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button className="add-session" disabled={!wt} onClick={() => wt && void store.addSession(wt, 'shell')}>
          + shell
        </button>
        <span className="toolbar-sep" />
        <button
          id="split-toggle"
          className={split ? 'active' : ''}
          title="Toggle split (⌘D)"
          onClick={() => store.toggleSplit()}
        >
          {split ? '◳ single' : '⊟ split'}
        </button>
        <button
          id="notif-btn"
          className={s.pending.size > 0 ? 'active' : ''}
          title="Notifications (⌘⇧U)"
          onClick={() => store.jumpToPending()}
        >
          🔔<span id="notif-count">{s.pending.size > 0 ? s.pending.size : ''}</span>
        </button>
        <button className="icon-btn" title="Settings" onClick={() => store.openSettings(true)}>
          ⚙
        </button>
      </div>
    </div>
  )
}
