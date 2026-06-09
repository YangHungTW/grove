import { useState, type CSSProperties, type DragEvent } from 'react'
import { useStore } from './useStore'
import { store } from './store'
import { AgentTabIcon, XIcon } from './Icons'

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
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dropOver, setDropOver] = useState(false)
  const commit = (id: string): void => {
    store.renameSession(id, draft)
    setEditing(null)
  }
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
        return editing === id ? (
          <div key={id} className="tab active">
            <input
              className="tab-rename"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(id)
                else if (e.key === 'Escape') setEditing(null)
              }}
            />
          </div>
        ) : (
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
            onDoubleClick={() => {
              setEditing(id)
              setDraft(sess.title)
            }}
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
