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
      return { ...DEFAULT_SETTINGS, ...parsed }
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
