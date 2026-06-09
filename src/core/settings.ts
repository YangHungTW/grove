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
  hookRemove: ''
}
