import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * A closed agent session that can be resumed. Grove launches resumable agents
 * (claude) with a pinned `--session-id <uuid>` so it owns the id; on close the
 * entry is kept here so the user can later relaunch `claude --resume <uuid>`.
 */
export interface ClosedAgent {
  repoRoot: string
  /** Worktree path the agent ran in (must match to resume from the same cwd). */
  worktreePath: string
  /** The pinned agent session uuid passed to `--resume`. */
  resumeId: string
  /** Base launch command without flags, e.g. 'claude' — used to rebuild resume. */
  baseCommand: string
  /** Tab title at close time (preserves a renamed tab). */
  title: string
  /** Tab icon. */
  icon?: string
  /** Epoch ms when the agent was closed (for the "x ago" label + ordering). */
  closedAt: number
}

/** Cap the list so it can't grow without bound. Most-recent-first. */
const MAX = 50

/**
 * Persists the recently-closed resumable agents so they survive an app restart.
 * Pure Node (no Electron) for unit-testability — mirrors LayoutStore.
 */
export class ClosedAgentsStore {
  private readonly file: string

  constructor(file: string) {
    this.file = file
  }

  load(): ClosedAgent[] {
    if (!existsSync(this.file)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter(
          (c): c is ClosedAgent =>
            typeof c?.repoRoot === 'string' &&
            typeof c?.worktreePath === 'string' &&
            typeof c?.resumeId === 'string' &&
            typeof c?.baseCommand === 'string' &&
            typeof c?.title === 'string' &&
            typeof c?.closedAt === 'number'
        )
        .slice(0, MAX)
    } catch {
      return []
    }
  }

  save(list: ClosedAgent[]): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(list.slice(0, MAX), null, 2))
  }
}
