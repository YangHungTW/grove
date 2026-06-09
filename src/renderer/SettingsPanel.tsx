import type { AgentDef } from '../core/settings'
import { useStore } from './useStore'
import { store } from './store'
import { KEYBIND_LABELS, AGENT_PRESETS } from '../core/settings'

export function SettingsPanel(): JSX.Element | null {
  const s = useStore()
  if (!s.settingsOpen) return null
  const cfg = s.settings
  const installedById = new Map(s.availableAgents.map((a) => [a.id, a.installed]))

  const setAgents = (agents: AgentDef[]): void => void store.updateSettings({ agents })
  const updateAgent = (i: number, patch: Partial<AgentDef>): void =>
    setAgents(cfg.agents.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  const removeAgent = (i: number): void => setAgents(cfg.agents.filter((_, idx) => idx !== i))
  const addAgent = (): void =>
    setAgents([
      ...cfg.agents,
      { id: 'a' + Math.random().toString(36).slice(2, 8), name: 'New agent', command: '', icon: '●' }
    ])

  return (
    <div className="settings-overlay" onClick={() => store.openSettings(false)}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>Settings</span>
          <button className="row-x" onClick={() => store.openSettings(false)}>
            ×
          </button>
        </div>

        <div className="settings-section">Appearance</div>

        <label className="settings-row">
          <span>Background colour</span>
          <input
            type="color"
            value={cfg.background}
            onChange={(e) => void store.updateSettings({ background: e.target.value })}
          />
        </label>

        <label className="settings-row">
          <span>Transparent window</span>
          <input
            type="checkbox"
            checked={cfg.transparent}
            onChange={(e) =>
              void store.updateSettings({
                transparent: e.target.checked,
                // 100% opacity = fully opaque even when transparent; give an
                // immediately visible effect when turning it on.
                opacity: e.target.checked && cfg.opacity >= 1 ? 0.82 : cfg.opacity
              })
            }
          />
        </label>

        <label className="settings-row">
          <span>Opacity {Math.round(cfg.opacity * 100)}%</span>
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.05}
            value={cfg.opacity}
            disabled={!cfg.transparent}
            onChange={(e) => void store.updateSettings({ opacity: Number(e.target.value) })}
          />
        </label>

        <div className="settings-section">Agents</div>
        {cfg.agents.map((a, i) => {
          const isInstalled = installedById.get(a.id)
          return (
            <div className="agent-edit" key={a.id}>
              <input
                className="agent-icon"
                value={a.icon}
                title="Icon"
                onChange={(e) => updateAgent(i, { icon: e.target.value })}
              />
              <input
                className="agent-name"
                value={a.name}
                placeholder="Name"
                onChange={(e) => updateAgent(i, { name: e.target.value })}
              />
              <input
                className="agent-cmd"
                value={a.command}
                placeholder="command"
                spellCheck={false}
                onChange={(e) => updateAgent(i, { command: e.target.value })}
              />
              <span
                className={'agent-state ' + (isInstalled ? 'ok' : 'missing')}
                title={isInstalled ? 'On PATH' : 'Not found on PATH'}
              >
                {isInstalled ? '●' : '○'}
              </span>
              <button className="row-x" title="Remove agent" onClick={() => removeAgent(i)}>
                ×
              </button>
            </div>
          )
        })}
        <div className="agent-actions">
          <button className="add-session" onClick={addAgent}>
            + Add agent
          </button>
          <button className="icon-btn" title="Reset to presets" onClick={() => setAgents(AGENT_PRESETS)}>
            Reset
          </button>
        </div>
        <small className="settings-note">
          ● installed · ○ not on PATH. Only installed agents appear in the + menu (one installed →
          opens directly, several → a dropdown).
        </small>

        <div className="settings-section">Worktree</div>

        <label className="settings-col">
          <span>Folder template (relative to project)</span>
          <input
            type="text"
            value={cfg.worktreeFolder}
            placeholder="../{repo}-wt-{branch}"
            onChange={(e) => void store.updateSettings({ worktreeFolder: e.target.value })}
          />
          <small>Placeholders: {'{repo}'}, {'{branch}'}</small>
        </label>
        <small className="settings-note">
          Create/remove <b>hooks are per-project</b> — set them from the ⚙ on each project in the
          sidebar.
        </small>

        <div className="settings-section">Keyboard shortcuts</div>
        {KEYBIND_LABELS.map(({ action, label }) => (
          <label className="settings-row" key={action}>
            <span>{label}</span>
            <input
              type="text"
              className="key-input"
              value={cfg.keybindings[action]}
              spellCheck={false}
              onChange={(e) =>
                void store.updateSettings({
                  keybindings: { ...cfg.keybindings, [action]: e.target.value }
                })
              }
            />
          </label>
        ))}
        <small className="settings-note">
          Format: modifiers + key, e.g. Ctrl+Shift+B or Cmd+T. Defaults match kitty (⌃⇧).
        </small>
      </div>
    </div>
  )
}
