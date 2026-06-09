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

        <label className="settings-col">
          <span>On create — run command</span>
          <input
            type="text"
            value={cfg.hookCreate}
            placeholder="e.g. cp .env {worktree}"
            onChange={(e) => void store.updateSettings({ hookCreate: e.target.value })}
          />
        </label>

        <label className="settings-col">
          <span>On remove — run command</span>
          <input
            type="text"
            value={cfg.hookRemove}
            onChange={(e) => void store.updateSettings({ hookRemove: e.target.value })}
          />
        </label>
        <small className="settings-note">
          Hooks run in a login shell with $CCM_WORKTREE_PATH, $CCM_BRANCH, $CCM_REPO.
          Keyboard-shortcut settings are coming next.
        </small>
      </div>
    </div>
  )
}
