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
  | 'toggleSidebar'

export type Keybindings = Record<KeybindAction, string>

/** Accelerator strings use '+': e.g. 'Ctrl+Shift+B', 'Meta+T'. */
export const DEFAULT_KEYBINDINGS: Keybindings = {
  splitToggle: 'Ctrl+Shift+B',
  newShell: 'Ctrl+Shift+Enter',
  closeSession: 'Ctrl+Shift+X',
  nextSession: 'Ctrl+Shift+N',
  prevSession: 'Ctrl+Shift+P',
  focusLeft: 'Ctrl+Shift+H',
  focusRight: 'Ctrl+Shift+L',
  toggleSidebar: 'Ctrl+Shift+S'
}

/** Human labels for the settings UI, in display order. */
export const KEYBIND_LABELS: { action: KeybindAction; label: string }[] = [
  { action: 'splitToggle', label: 'Toggle split' },
  { action: 'newShell', label: 'New shell' },
  { action: 'closeSession', label: 'Close session' },
  { action: 'nextSession', label: 'Next session' },
  { action: 'prevSession', label: 'Previous session' },
  { action: 'focusLeft', label: 'Focus previous pane' },
  { action: 'focusRight', label: 'Focus next pane' },
  { action: 'toggleSidebar', label: 'Toggle sidebar' }
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
  /** Enable window vibrancy / transparent background. */
  transparent: boolean
  /** Whether the sidebar is collapsed. */
  sidebarCollapsed: boolean
  /** Configured agents for the "+" menu. */
  agents: AgentDef[]
  /** Worktree folder template, relative to the project (supports {branch}, {repo}). */
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

export const DEFAULT_SETTINGS: AppSettings = {
  background: '#1b1b1f',
  foreground: '#dcdce4',
  opacity: 1,
  transparent: false,
  sidebarCollapsed: false,
  agents: AGENT_PRESETS,
  worktreeFolder: '../{repo}-wt-{branch}',
  keybindings: DEFAULT_KEYBINDINGS,
  disabledAgents: []
}
