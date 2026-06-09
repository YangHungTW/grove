import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { basename, dirname } from 'node:path'

export interface ProjectEntry {
  /** Absolute path to the git repo root. Also the stable id. */
  repoRoot: string
  /** Display name (path basename). */
  name: string
  /** Per-project hook: command/script/agent run on worktree create. */
  hookCreate?: string
  /** Per-project hook: command/script/agent run on worktree remove. */
  hookRemove?: string
}

/** Fields of a project that can be updated in place. */
export type ProjectPatch = Partial<Pick<ProjectEntry, 'hookCreate' | 'hookRemove'>>

/**
 * Persisted list of recently-opened projects (most-recent first). Pure Node
 * (no Electron) so it is unit-testable. The owning process supplies the JSON
 * file path (e.g. under Electron's userData).
 */
export class ProjectStore {
  private readonly file: string
  private entries: ProjectEntry[]

  constructor(file: string) {
    this.file = file
    this.entries = this.read()
  }

  list(): ProjectEntry[] {
    return [...this.entries]
  }

  add(repoRoot: string): ProjectEntry {
    const entry: ProjectEntry = { repoRoot, name: basename(repoRoot) }
    this.entries = [entry, ...this.entries.filter((e) => e.repoRoot !== repoRoot)]
    this.write()
    return entry
  }

  remove(repoRoot: string): void {
    this.entries = this.entries.filter((e) => e.repoRoot !== repoRoot)
    this.write()
  }

  /** Merge per-project config into an existing entry (no-op if unknown). */
  update(repoRoot: string, patch: ProjectPatch): void {
    let changed = false
    this.entries = this.entries.map((e) => {
      if (e.repoRoot !== repoRoot) return e
      changed = true
      return { ...e, ...patch }
    })
    if (changed) this.write()
  }

  get(repoRoot: string): ProjectEntry | undefined {
    return this.entries.find((e) => e.repoRoot === repoRoot)
  }

  private read(): ProjectEntry[] {
    if (!existsSync(this.file)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((e): e is ProjectEntry => typeof e?.repoRoot === 'string')
        .map((e) => ({
          repoRoot: e.repoRoot,
          name: e.name ?? basename(e.repoRoot),
          hookCreate: e.hookCreate,
          hookRemove: e.hookRemove
        }))
    } catch {
      return []
    }
  }

  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.entries, null, 2))
  }
}
