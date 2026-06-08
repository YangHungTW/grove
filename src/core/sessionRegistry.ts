import type { NewSession, Session } from './types'

let counter = 0
function genId(): string {
  counter += 1
  return `s${counter}_${counter.toString(36)}`
}

/**
 * In-memory registry mapping a worktree to its sessions. A worktree may hold any
 * number of sessions of any kind (multiple agents + shells).
 */
export class SessionRegistry {
  private readonly byId = new Map<string, Session>()
  private readonly byWorktree = new Map<string, Set<string>>()

  addSession(input: NewSession): Session {
    const session: Session = {
      id: input.id ?? genId(),
      worktreeId: input.worktreeId,
      kind: input.kind,
      title: input.title ?? defaultTitle(input.kind),
      cwd: input.cwd,
      command: input.command,
      state: input.state ?? 'starting',
      pid: input.pid
    }

    this.byId.set(session.id, session)
    let set = this.byWorktree.get(session.worktreeId)
    if (!set) {
      set = new Set()
      this.byWorktree.set(session.worktreeId, set)
    }
    set.add(session.id)
    return session
  }

  getSession(id: string): Session | undefined {
    return this.byId.get(id)
  }

  getSessions(worktreeId: string): Session[] {
    const ids = this.byWorktree.get(worktreeId)
    if (!ids) return []
    return [...ids].map((id) => this.byId.get(id)!).filter(Boolean)
  }

  removeSession(id: string): void {
    const session = this.byId.get(id)
    if (!session) return
    this.byId.delete(id)
    this.byWorktree.get(session.worktreeId)?.delete(id)
  }

  /** Does this worktree already have a live agent session? */
  hasAgent(worktreeId: string): boolean {
    return this.getSessions(worktreeId).some((s) => s.kind === 'agent')
  }

  /** All sessions across all worktrees. */
  all(): Session[] {
    return [...this.byId.values()]
  }
}

function defaultTitle(kind: NewSession['kind']): string {
  return kind
}
