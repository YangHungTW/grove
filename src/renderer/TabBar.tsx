import { useStore } from './useStore'
import { store } from './store'

export function TabBar(): JSX.Element {
  const s = useStore()
  const sessions = s.activeWorktreeId ? s.sessionsOf(s.activeWorktreeId) : []
  const split = s.isSplit()

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
        {sessions.map((sess) => (
          <button
            key={sess.id}
            className={
              'tab' +
              (sess.id === s.focusedSessionId ? ' active' : '') +
              (s.pending.has(sess.id) ? ' attention' : '')
            }
            onClick={() => store.focusSession(sess.id)}
          >
            <span className={`dot dot-${sess.state}`} />
            <span className="tab-title">
              {sess.kind === 'agent' ? '★ ' : ''}
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
        ))}
      </div>
      <div id="toolbar">
        <button
          className="add-session"
          disabled={!s.activeWorktreeId}
          onClick={() => s.activeWorktreeId && void store.addSession(s.activeWorktreeId, 'agent')}
        >
          + agent
        </button>
        <button
          className="add-session"
          disabled={!s.activeWorktreeId}
          onClick={() => s.activeWorktreeId && void store.addSession(s.activeWorktreeId, 'shell')}
        >
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
