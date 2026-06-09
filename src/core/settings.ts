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

export interface AppSettings {
  /** Chrome/background base color (hex). */
  background: string
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
  /** Shell command to run on worktree create/remove (cwd = worktree/repo). */
  hookCreate: string
  hookRemove: string
  /** Customisable keyboard shortcuts (action -> accelerator). */
  keybindings: Keybindings
}

/** Built-in agent presets shown in the "+" menu (filtered to installed ones). */
export const AGENT_PRESETS: AgentDef[] = [
  { id: 'claude', name: 'Claude', command: 'claude', icon: '★' },
  { id: 'codex', name: 'Codex', command: 'codex', icon: '◆' },
  { id: 'gemini', name: 'Gemini', command: 'gemini', icon: '✦' }
]

/** Icon for plain shell sessions. */
export const SHELL_ICON = '❯'

export const DEFAULT_SETTINGS: AppSettings = {
  background: '#1b1b1f',
  opacity: 1,
  transparent: false,
  sidebarCollapsed: false,
  agents: AGENT_PRESETS,
  worktreeFolder: '../{repo}-wt-{branch}',
  hookCreate: '',
  hookRemove: '',
  keybindings: DEFAULT_KEYBINDINGS
}
