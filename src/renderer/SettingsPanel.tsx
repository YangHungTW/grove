import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import type { AgentDef } from '../core/settings'
import { parseSkillList } from '../core/skills'
import { useStore } from './useStore'
import { store } from './store'
import {
  KEYBIND_LABELS,
  FIXED_SHORTCUTS,
  FONT_OPTIONS,
  AGENT_PRESETS,
  IDE_PRESETS,
  THEMES
} from '../core/settings'

export function SettingsPanel(): JSX.Element | null {
  const s = useStore()
  // Force the custom editor inputs open even when the command is still empty.
  const [ideCustom, setIdeCustom] = useState(false)
  if (!s.settingsOpen) return null
  const cfg = s.settings
  const installedById = new Map(s.availableAgents.map((a) => [a.id, a.installed]))

  // Editor / IDE picker: a preset dropdown (None / presets / Custom…). A custom
  // selection reveals a command field + a "terminal editor" toggle.
  const ide = cfg.ide ?? { command: '', terminal: false }
  const idePreset = IDE_PRESETS.find((p) => p.command === ide.command && p.terminal === ide.terminal)
  const ideIsCustom = ideCustom || (ide.command.trim() !== '' && !idePreset)
  const ideSelect = ideIsCustom ? 'custom' : ide.command.trim() === '' ? 'none' : idePreset!.id
  const onIdeSelect = (v: string): void => {
    if (v === 'custom') {
      setIdeCustom(true)
      return
    }
    setIdeCustom(false)
    if (v === 'none') void store.updateSettings({ ide: { command: '', terminal: false } })
    else {
      const p = IDE_PRESETS.find((x) => x.id === v)
      if (p) void store.updateSettings({ ide: { command: p.command, terminal: p.terminal } })
    }
  }
  const updateIde = (patch: Partial<typeof ide>): void =>
    void store.updateSettings({ ide: { ...ide, ...patch } })

  // Font picker: curated monospace fonts that are actually installed (document.
  // fonts.check needs no permission), plus a "Custom…" path where the user types
  // any family name. fontFamily not in the list ⇒ custom mode (show the input).
  const FONT_CUSTOM = '__custom__'
  const fontChoices = [
    ...new Set(['MesloLGS NF', ...FONT_OPTIONS.filter((f) => document.fonts.check(`13px "${f}"`))])
  ]
  const fontIsCustom = !fontChoices.includes(cfg.fontFamily)

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

        <div className="settings-section">Theme</div>
        <div className="theme-grid">
          {THEMES.map((t) => {
            const active = cfg.background.toLowerCase() === t.background.toLowerCase()
            return (
              <button
                key={t.id}
                className={'theme-swatch' + (active ? ' active' : '')}
                style={{ background: t.background, color: t.foreground }}
                title={t.name}
                onClick={() =>
                  void store.updateSettings({ background: t.background, foreground: t.foreground })
                }
              >
                <span className="theme-sample">Aa</span>
                <span className="theme-name">{t.name}</span>
              </button>
            )
          })}
        </div>
        <div className="settings-row">
          <span>Custom colours</span>
          <span className="theme-customs">
            <input
              type="color"
              title="Background"
              value={cfg.background}
              onChange={(e) => void store.updateSettings({ background: e.target.value })}
            />
            <input
              type="color"
              title="Text"
              value={cfg.foreground}
              onChange={(e) => void store.updateSettings({ foreground: e.target.value })}
            />
          </span>
        </div>

        <label className="settings-row">
          <span>Font</span>
          <select
            className="key-input"
            style={{ width: 184 }}
            value={fontIsCustom ? FONT_CUSTOM : cfg.fontFamily}
            onChange={(e) =>
              void store.updateSettings({
                fontFamily: e.target.value === FONT_CUSTOM ? '' : e.target.value
              })
            }
          >
            {fontChoices.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            <option value={FONT_CUSTOM}>Custom…</option>
          </select>
        </label>

        {fontIsCustom && (
          <label className="settings-row">
            <span>Custom font</span>
            <DraftInput
              type="text"
              className="key-input"
              style={{ width: 184 }}
              value={cfg.fontFamily}
              spellCheck={false}
              placeholder="Exact font name"
              onCommit={(v) => void store.updateSettings({ fontFamily: v })}
            />
          </label>
        )}

        <FontSizeRow value={cfg.fontSize} />

        <label className="settings-row">
          <span title="Off = canvas 2D. Slightly laggier typing, but immune to the WebGL glyph corruption some GPUs show on an agent's status row.">
            GPU terminal rendering
          </span>
          <input
            type="checkbox"
            checked={cfg.gpuRenderer}
            onChange={(e) => void store.updateSettings({ gpuRenderer: e.target.checked })}
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

        <OpacityRow value={cfg.opacity} disabled={!cfg.transparent} />

        <div className="settings-section">Sessions</div>
        <label
          className="settings-row"
          title="Run agents inside tmux (control mode) so they survive a Grove restart and reattach to the live process. Requires tmux on PATH; falls back to a normal session when tmux is missing."
        >
          <span>Durable sessions (tmux)</span>
          <input
            type="checkbox"
            checked={cfg.durableSessions}
            onChange={(e) => void store.updateSettings({ durableSessions: e.target.checked })}
          />
        </label>

        <div className="settings-section">Editor</div>
        <label className="settings-row">
          <span>Open files in</span>
          <select
            className="key-input"
            style={{ width: 184 }}
            value={ideSelect}
            onChange={(e) => onIdeSelect(e.target.value)}
          >
            <option value="none">None</option>
            {IDE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </label>
        {ideIsCustom && (
          <>
            <label className="settings-row">
              <span>Editor command</span>
              <DraftInput
                type="text"
                className="key-input"
                style={{ width: 184 }}
                value={ide.command}
                spellCheck={false}
                placeholder="e.g. code, subl, nvim"
                onCommit={(v) => updateIde({ command: v })}
              />
            </label>
            <label className="settings-row">
              <span>Terminal editor (open in a shell)</span>
              <input
                type="checkbox"
                checked={ide.terminal}
                onChange={(e) => updateIde({ terminal: e.target.checked })}
              />
            </label>
          </>
        )}
        <small className="settings-note">
          Adds an “open whole file” icon to the Changes view. GUI editors launch directly; terminal
          editors (vim, nvim…) open the file in an in-app shell.
        </small>

        <div className="settings-section">Agents</div>
        {cfg.agents.map((a, i) => {
          const isInstalled = installedById.get(a.id)
          return (
            <div className="agent-edit" key={a.id}>
              <DraftInput
                className="agent-icon"
                value={a.icon}
                title="Icon"
                onCommit={(v) => updateAgent(i, { icon: v })}
              />
              <DraftInput
                className="agent-name"
                value={a.name}
                placeholder="Name"
                onCommit={(v) => updateAgent(i, { name: v })}
              />
              <DraftInput
                className="agent-cmd"
                value={a.command}
                placeholder="command"
                spellCheck={false}
                onCommit={(v) => updateAgent(i, { command: v })}
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
              <AgentSkillsField
                value={a.skills ?? []}
                onCommit={(skills) => updateAgent(i, { skills })}
              />
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
          <DraftInput
            type="text"
            value={cfg.worktreeFolder}
            placeholder="../{repo}-wt-{branch}"
            onCommit={(v) => void store.updateSettings({ worktreeFolder: v })}
          />
          <small>Placeholders: {'{repo}'}, {'{branch}'}, {'{timestamp}'}</small>
        </label>
        <small className="settings-note">
          Create/remove <b>hooks are per-project</b> — set them from the ⚙ on each project in the
          sidebar.
        </small>

        <div className="settings-section">Keyboard shortcuts</div>
        {KEYBIND_LABELS.map(({ action, label }) => (
          <label className="settings-row" key={action}>
            <span>{label}</span>
            <DraftInput
              type="text"
              className="key-input"
              value={cfg.keybindings[action]}
              spellCheck={false}
              onCommit={(v) =>
                void store.updateSettings({
                  keybindings: { ...cfg.keybindings, [action]: v }
                })
              }
            />
          </label>
        ))}
        <small className="settings-note">
          Format: modifiers + key, e.g. Ctrl+Shift+B or Cmd+T. Defaults match kitty (⌃⇧).
        </small>

        <div className="settings-section">Navigation (fixed)</div>
        {FIXED_SHORTCUTS.map(({ label, keys }) => (
          <div className="settings-row" key={label}>
            <span>{label}</span>
            <kbd className="key-fixed">{keys}</kbd>
          </div>
        ))}
        <small className="settings-note">
          These ⌘ shortcuts are built in and can&apos;t be rebound.
        </small>
      </div>
    </div>
  )
}

/** How long a settings text field / slider waits after the last edit before
 * committing to the store. Long enough to swallow a typing burst or a slider
 * drag, short enough that a pause reads as "applied". */
const DRAFT_COMMIT_MS = 300

/**
 * Hold a field's value locally while it is being edited and commit it on a
 * trailing debounce — or at once on blur / Enter / unmount. Every change used
 * to go straight to store.updateSettings: one IPC settings-file write per
 * keystroke or slider notch, and for the font fields a re-theme + refit of
 * every pane per character. store.updateSettings itself stays immediate (and
 * its tests count saves); only these controls coalesce. The draft is the
 * input's value while editing, so the caret never fights a lagging store value.
 *
 * `onPreview`, when given, runs on EVERY edit (the sliders pass
 * store.previewSettings so the app tracks the drag live); only the save waits.
 */
function useDraft(
  value: string,
  onCommit: (v: string) => void,
  onPreview?: (v: string) => void
): { draft: string; edit: (v: string) => void; flush: () => void } {
  // null = not editing → mirror the store (so a Reset / external change shows).
  const [draft, setDraft] = useState<string | null>(null)
  const pending = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // Always commit through the latest closure: the callers build the patch from
  // the current settings (keybindings map, agents list).
  const commit = useRef(onCommit)
  commit.current = onCommit
  const preview = useRef(onPreview)
  preview.current = onPreview
  const commitPending = useCallback((): void => {
    window.clearTimeout(timer.current)
    const v = pending.current
    pending.current = null
    if (v !== null) commit.current(v)
  }, [])
  const flush = useCallback((): void => {
    commitPending()
    setDraft(null)
  }, [commitPending])
  const edit = useCallback(
    (v: string): void => {
      setDraft(v)
      pending.current = v
      preview.current?.(v)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, DRAFT_COMMIT_MS)
    },
    [flush]
  )
  // Closing the panel mid-edit must not lose the last keystrokes.
  useEffect(() => commitPending, [commitPending])
  return { draft: draft ?? value, edit, flush }
}

/** A text <input> whose value reaches the store through useDraft. */
function DraftInput({
  value,
  onCommit,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string
  onCommit: (v: string) => void
}): JSX.Element {
  const { draft, edit, flush } = useDraft(value, onCommit)
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => edit(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') flush()
      }}
    />
  )
}

/** Font size slider: each step previews live (panes re-font as you drag); the
 * value is saved once the drag settles. */
function FontSizeRow({ value }: { value: number }): JSX.Element {
  const { draft, edit, flush } = useDraft(
    String(value),
    (v) => void store.updateSettings({ fontSize: Number(v) }),
    (v) => store.previewSettings({ fontSize: Number(v) })
  )
  return (
    <label className="settings-row">
      <span>Font size {draft}px</span>
      <input
        type="range"
        min={9}
        max={24}
        step={1}
        value={draft}
        onChange={(e) => edit(e.target.value)}
        onBlur={flush}
      />
    </label>
  )
}

/** Opacity slider (enabled only while the window is transparent); previews
 * live, saves once per gesture. */
function OpacityRow({ value, disabled }: { value: number; disabled: boolean }): JSX.Element {
  const { draft, edit, flush } = useDraft(
    String(value),
    (v) => void store.updateSettings({ opacity: Number(v) }),
    (v) => store.previewSettings({ opacity: Number(v) })
  )
  return (
    <label className="settings-row">
      <span>Opacity {Math.round(Number(draft) * 100)}%</span>
      <input
        type="range"
        min={0.3}
        max={1}
        step={0.05}
        value={draft}
        disabled={disabled}
        onChange={(e) => edit(e.target.value)}
        onBlur={flush}
      />
    </label>
  )
}

/**
 * Comma-separated skill ids for one agent. Holds raw text locally and commits
 * on blur: deriving the input's value from the parsed array would swallow the
 * comma the instant the user typed it (parse drops the empty trailing entry,
 * join renders it away), making the field feel broken.
 */
function AgentSkillsField({
  value,
  onCommit
}: {
  value: string[]
  onCommit: (skills: string[]) => void
}): JSX.Element {
  const [raw, setRaw] = useState(value.join(', '))
  const [editing, setEditing] = useState(false)
  return (
    <input
      className="agent-skills"
      // While idle, mirror the stored value (e.g. after a Reset to presets);
      // while editing, the user's raw text is the source of truth.
      value={editing ? raw : value.join(', ')}
      placeholder="default skills, comma-separated (optional)"
      spellCheck={false}
      title="Skills this agent starts a New task with. Invoked as /name lines ahead of your task; empty means nothing is injected."
      onFocus={() => {
        setRaw(value.join(', '))
        setEditing(true)
      }}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        setEditing(false)
        onCommit(parseSkillList(raw))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}
