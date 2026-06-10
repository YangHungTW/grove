import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SessionKind } from './types'

/** A persisted, respawnable description of a session (no live pty). */
export interface SessionDescriptor {
  repoRoot: string
  worktreePath: string
  kind: SessionKind
  title: string
  /** Tab icon — also used on restore to recover which agent it was. */
  icon?: string
  /** Pinned agent session id (claude) — restored via `--resume` so the agent
   * reopens its previous conversation instead of starting fresh. */
  resumeId?: string
}

/**
 * Persists the set of open sessions so the layout can be restored on relaunch.
 * PTYs are process-bound and cannot be truly resurrected — descriptors are
 * respawned as fresh sessions. Pure Node (no Electron) for unit-testability.
 */
export class LayoutStore {
  private readonly file: string

  constructor(file: string) {
    this.file = file
  }

  load(): SessionDescriptor[] {
    if (!existsSync(this.file)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (d): d is SessionDescriptor =>
          typeof d?.repoRoot === 'string' &&
          typeof d?.worktreePath === 'string' &&
          typeof d?.kind === 'string'
      )
    } catch {
      return []
    }
  }

  save(descriptors: SessionDescriptor[]): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(descriptors, null, 2))
  }
}
