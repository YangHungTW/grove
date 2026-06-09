import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from './settings'

export { DEFAULT_SETTINGS } from './settings'
export type { AppSettings, AgentDef } from './settings'

/** Persisted app settings (pure Node, unit-testable). */
export class SettingsStore {
  private readonly file: string

  constructor(file: string) {
    this.file = file
  }

  load(): AppSettings {
    if (!existsSync(this.file)) return { ...DEFAULT_SETTINGS }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      // Migrate the legacy single-Claude default (auto-created before the agent
      // list was user-editable) up to the current presets.
      const a = parsed.agents
      const isLegacyDefault =
        !Array.isArray(a) || (a.length === 1 && a[0]?.id === 'claude' && a[0]?.command === 'claude')
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        agents: isLegacyDefault ? DEFAULT_SETTINGS.agents : a,
        // Deep-merge keybindings so new actions get defaults on older files.
        keybindings: { ...DEFAULT_SETTINGS.keybindings, ...parsed.keybindings }
      }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  save(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.load(), ...patch }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(next, null, 2))
    return next
  }
}
