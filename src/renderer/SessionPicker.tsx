import { useStore } from './useStore'
import { store } from './store'
import { AgentTabIcon, ShellIcon } from './Icons'

/**
 * The ⌘T new-session picker: a small modal list of "Shell" + the installed
 * agents. Keyboard-driven (↑/↓/j/k to move, ↵ to open, esc to cancel — handled
 * in App's global key handler while `pickerOpen`); clicking an item opens it
 * directly. Replaces the old separate new-shell / new-agent shortcuts + the
 * agent-chooser dropdown.
 */
export function SessionPicker(): JSX.Element | null {
  const s = useStore()
  if (!s.pickerOpen) return null
  const items = s.pickerItems()
  return (
    <div className="picker-overlay" onMouseDown={() => store.closePicker()}>
      <div className="picker" onMouseDown={(e) => e.stopPropagation()}>
        <div className="picker-title">New session</div>
        {items.map((it, i) => (
          <button
            key={it.kind === 'shell' ? 'shell' : it.agent.id}
            className={'picker-item' + (i === s.pickerIndex ? ' active' : '')}
            onClick={() => store.confirmPicker(i)}
          >
            <span className="picker-icon">
              {it.kind === 'shell' ? (
                <ShellIcon size={14} />
              ) : (
                <AgentTabIcon icon={it.agent.icon} size={14} />
              )}
            </span>
            <span className="picker-label">{it.kind === 'shell' ? 'Shell' : it.agent.name}</span>
            {it.kind === 'agent' && <span className="picker-cmd">{it.agent.command}</span>}
          </button>
        ))}
        <div className="picker-hint">↑↓ / j k move · ↵ open · esc cancel</div>
      </div>
    </div>
  )
}
