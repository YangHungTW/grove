import { useStore } from './useStore'
import { store } from './store'

export function SettingsPanel(): JSX.Element | null {
  const s = useStore()
  if (!s.settingsOpen) return null
  const cfg = s.settings

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
            onChange={(e) => void store.updateSettings({ transparent: e.target.checked })}
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

        <p className="settings-note">
          More settings (agents, worktree folder, hooks, keyboard shortcuts) are coming next.
        </p>
      </div>
    </div>
  )
}
