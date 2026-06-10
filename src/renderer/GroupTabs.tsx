import { useState, type CSSProperties, type DragEvent } from 'react'
import { useStore } from './useStore'
import { store } from './store'
import type { ClosedAgent } from '../core/closedAgentsStore'
import { AgentTabIcon, XIcon, HistoryIcon } from './Icons'

/** Compact "x ago" label for a closed-agent timestamp. */
function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

// The session id currently being dragged (transient; not store state).
let dragId: string | null = null

/** Per-group tab strips, laid out in the same columns as the panes (VS Code
 * editor groups). One strip per group; the focused group is highlighted.
 * Tabs can be dragged between strips (groups) or reordered within a strip. */
export function GroupTabs(): JSX.Element | null {
  const s = useStore()
  const wt = s.activeWorktreeId
  if (!wt) return null
  const groups = s.groupsOf(wt)
  const focusedG = s.focusedGroup(wt)
  const style: CSSProperties = { gridTemplateColumns: s.colFr.map((f) => `${f}fr`).join(' ') }

  return (
    <div id="grouptabs" style={style} className={groups.length <= 1 ? 'single' : ''}>
      {groups.map((g, gi) => (
        <GroupStrip key={gi} gi={gi} ids={g.ids} active={g.active} focused={gi === focusedG} />
      ))}
      <RecentlyClosed wt={wt} />
    </div>
  )
}

/** Trailing control: lists this worktree's recently-closed agents; click one to
 * relaunch it with `claude --resume <id>`. Hidden when there are none. */
function RecentlyClosed({ wt }: { wt: string }): JSX.Element | null {
  const s = useStore()
  const [open, setOpen] = useState(false)
  const closed = s.closedAgentsOf(wt)
  if (closed.length === 0) return null
  return (
    <div className="recent-closed">
      <button
        className={'recent-btn' + (open ? ' open' : '')}
        title="Recently closed agents — click to resume"
        onClick={() => setOpen((o) => !o)}
      >
        <HistoryIcon size={13} />
        <span className="recent-count">{closed.length}</span>
      </button>
      {open && (
        <>
          <div className="recent-backdrop" onClick={() => setOpen(false)} />
          <ul className="recent-menu">
            <li className="recent-head">Recently closed — resume</li>
            {closed.map((c: ClosedAgent) => (
              <li key={c.resumeId} className="recent-item">
                <button
                  className="recent-resume"
                  title={`Resume ${c.title} (claude --resume ${c.resumeId})`}
                  onClick={() => {
                    setOpen(false)
                    store.resumeClosedAgent(c)
                  }}
                >
                  <span className="recent-icon">
                    <AgentTabIcon icon={c.icon} />
                  </span>
                  <span className="recent-title">{c.title}</span>
                  <span className="recent-time">{timeAgo(c.closedAt)}</span>
                </button>
                <button
                  className="recent-forget"
                  title="Remove from list"
                  onClick={(e) => {
                    e.stopPropagation()
                    store.forgetClosedAgent(c)
                  }}
                >
                  <XIcon size={11} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function GroupStrip({
  gi,
  ids,
  active,
  focused
}: {
  gi: number
  ids: string[]
  active: string
  focused: boolean
}): JSX.Element {
  const s = useStore()
  const [dropOver, setDropOver] = useState(false)
  const allowDrop = (e: DragEvent): void => {
    if (dragId) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }

  return (
    <div
      className={'group-strip' + (focused ? ' focused' : '') + (dropOver ? ' drop-over' : '')}
      onDragOver={(e) => {
        allowDrop(e)
        if (dragId) setDropOver(true)
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropOver(false)
        if (dragId) store.reorderSession(dragId, gi) // append to this group
        dragId = null
      }}
    >
      {ids.map((id) => {
        const sess = s.sessions.get(id)
        if (!sess) return null
        return (
          <button
            key={id}
            draggable
            data-kind={sess.kind}
            data-icon={sess.icon}
            className={
              'tab' + (id === active ? ' active' : '') + (s.pending.has(id) ? ' attention' : '')
            }
            title="Drag to move · double-click to rename"
            onClick={() => store.focusSession(id)}
            onDoubleClick={() => store.promptRename(id)}
            onDragStart={(e) => {
              dragId = id
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', id)
            }}
            onDragEnd={() => {
              dragId = null
              setDropOver(false)
            }}
            onDragOver={(e) => {
              allowDrop(e)
              e.stopPropagation()
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDropOver(false)
              if (dragId) store.reorderSession(dragId, gi, id) // insert before this tab
              dragId = null
            }}
          >
            <span className={`dot dot-${sess.state}`} />
            <span className="tab-icon">
              <AgentTabIcon icon={sess.icon} />
            </span>
            <span className="tab-title">{sess.title}</span>
            <button
              className="tab-x"
              onClick={(e) => {
                e.stopPropagation()
                store.closeSession(id)
              }}
            >
              <XIcon size={11} />
            </button>
          </button>
        )
      })}
    </div>
  )
}
