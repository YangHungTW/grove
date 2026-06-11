/** Browser-safe settings types + defaults (no Node imports), so the renderer
 * can use them without pulling in the fs-backed SettingsStore. */

/** A configured coding agent shown in the "+" menu. */
export interface AgentDef {
  id: string
  name: string
  /** Command typed/run to launch it (e.g. 'claude'). */
  command: string
  /** Single-character or emoji icon for the tab. */
  icon: string
}

/** An AgentDef plus whether its command is currently on PATH. */
export type ResolvedAgent = AgentDef & { installed: boolean }

/** Actions that can be bound to a keyboard shortcut. */
export type KeybindAction =
  | 'splitToggle'
  | 'newShell'
  | 'closeSession'
  | 'nextSession'
  | 'prevSession'
  | 'focusLeft'
  | 'focusRight'
  | 'moveToOtherGroup'
  | 'renameTab'
  | 'toggleSidebar'
  | 'zoomPane'

export type Keybindings = Record<KeybindAction, string>

/** Accelerator strings use '+': e.g. 'Ctrl+Shift+B', 'Meta+T'. */
export const DEFAULT_KEYBINDINGS: Keybindings = {
  splitToggle: 'Ctrl+Shift+E',
  newShell: 'Ctrl+Shift+Enter',
  closeSession: 'Ctrl+Shift+W',
  nextSession: 'Ctrl+Shift+N',
  prevSession: 'Ctrl+Shift+P',
  focusLeft: 'Ctrl+Shift+H',
  focusRight: 'Ctrl+Shift+L',
  moveToOtherGroup: 'Ctrl+Shift+M',
  renameTab: 'Ctrl+Shift+R',
  toggleSidebar: 'Ctrl+Shift+S',
  zoomPane: 'Ctrl+Shift+T'
}

/** Human labels for the settings UI, in display order. */
export const KEYBIND_LABELS: { action: KeybindAction; label: string }[] = [
  { action: 'splitToggle', label: 'Split / merge' },
  { action: 'newShell', label: 'New shell' },
  { action: 'closeSession', label: 'Close tab' },
  { action: 'nextSession', label: 'Next tab' },
  { action: 'prevSession', label: 'Previous tab' },
  { action: 'focusLeft', label: 'Focus left group' },
  { action: 'focusRight', label: 'Focus right group' },
  { action: 'moveToOtherGroup', label: 'Move tab to other group' },
  { action: 'renameTab', label: 'Rename tab' },
  { action: 'toggleSidebar', label: 'Toggle sidebar' },
  { action: 'zoomPane', label: 'Zoom / unzoom pane' }
]

/** Fixed (non-rebindable) shortcuts, shown read-only in settings for discovery.
 * These are wired in App.tsx and match on physical keys (e.code), so they can't
 * be expressed by the editable accelerator list above. */
export const FIXED_SHORTCUTS: { label: string; keys: string }[] = [
  { label: 'Previous / next tab', keys: '⌘⇧[  /  ⌘⇧]' },
  { label: 'Previous / next worktree', keys: '⌘⇧↑ / ⌘⇧↓  (⌘⇧K / ⌘⇧J)' },
  { label: 'Previous / next project', keys: '⌘⇧← / ⌘⇧→  (⌘⇧H / ⌘⇧L)' },
  { label: 'Jump to worktree 1–9', keys: '⌘1 … ⌘9' },
  { label: 'Jump to project 1–9', keys: '⌘⌥1 … ⌘⌥9' },
  { label: 'New shell', keys: '⌘T' },
  { label: 'Close tab', keys: '⌘W' },
  { label: 'Split / merge', keys: '⌘D' },
  { label: 'Find in terminal', keys: '⌘F' },
  { label: 'Toggle sidebar', keys: '⌘B' },
  { label: 'Jump to agent needing input', keys: '⌘⇧U' },
  { label: 'Open settings', keys: '⌘,' }
]

/** A coordinated colour theme (terminal + chrome). */
export interface Theme {
  id: string
  name: string
  background: string
  foreground: string
}

/** Built-in dark themes for the appearance picker. */
export const THEMES: Theme[] = [
  { id: 'dark', name: 'Default Dark', background: '#1b1b1f', foreground: '#dcdce4' },
  { id: 'ink', name: 'Ink', background: '#0d0d12', foreground: '#cdd0e0' },
  { id: 'carbon', name: 'Carbon', background: '#161821', foreground: '#c6c8d1' },
  { id: 'dracula', name: 'Dracula', background: '#282a36', foreground: '#f8f8f2' },
  { id: 'nord', name: 'Nord', background: '#2e3440', foreground: '#d8dee9' },
  { id: 'gruvbox', name: 'Gruvbox', background: '#282828', foreground: '#ebdbb2' },
  { id: 'solarized', name: 'Solarized', background: '#002b36', foreground: '#93a1a1' }
]

export interface AppSettings {
  /** Chrome/terminal background color (hex). */
  background: string
  /** Foreground/text color (hex). */
  foreground: string
  /** Background opacity 0..1 (used when transparent is on). */
  opacity: number
  /** Terminal font family (a single family name; the bundled Nerd Font is kept
   * as a fallback so box-drawing/agent glyphs always render). */
  fontFamily: string
  /** Terminal font size in px. */
  fontSize: number
  /** Enable window vibrancy / transparent background. */
  transparent: boolean
  /** Whether the sidebar is collapsed. */
  sidebarCollapsed: boolean
  /** Configured agents for the "+" menu. */
  agents: AgentDef[]
  /** Worktree folder template, relative to the project (supports {branch}, {repo}, {timestamp}). */
  worktreeFolder: string
  /** Customisable keyboard shortcuts (action -> accelerator). */
  keybindings: Keybindings
  /** Agent ids the user has turned off (hidden from the "+" menu even if installed). */
  disabledAgents: string[]
}

/** Built-in agent presets shown in the "+" menu (filtered to installed ones). */
export const AGENT_PRESETS: AgentDef[] = [
  { id: 'claude', name: 'Claude', command: 'claude', icon: '★' },
  { id: 'codex', name: 'Codex', command: 'codex', icon: '◆' },
  { id: 'antigravity', name: 'Antigravity', command: 'agy', icon: '✦' }
]

/** Icon for plain shell sessions. */
export const SHELL_ICON = '❯'

/** Bundled Nerd Font kept as a fallback after the user's chosen family, so
 * box-drawing lines and agent UI glyphs always render even with a plain font. */
export const FONT_FALLBACK = '"MesloLGS NF", "MesloLGS Nerd Font", Menlo, Monaco, "Courier New", monospace'

/** Curated monospace fonts offered in the settings font picker (only the ones
 * actually installed are shown; 'MesloLGS NF' is bundled). For anything else the
 * user picks "Custom…" and types the family name — no font-enumeration permission. */
export const FONT_OPTIONS = [
  'MesloLGS NF',
  'SF Mono',
  'Menlo',
  'Monaco',
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Hack',
  'Source Code Pro',
  'Courier New'
]

export const DEFAULT_SETTINGS: AppSettings = {
  background: '#1b1b1f',
  foreground: '#dcdce4',
  opacity: 1,
  fontFamily: 'MesloLGS NF',
  fontSize: 13,
  transparent: false,
  sidebarCollapsed: false,
  agents: AGENT_PRESETS,
  worktreeFolder: '../{repo}-wt-{branch}',
  keybindings: DEFAULT_KEYBINDINGS,
  disabledAgents: []
}
