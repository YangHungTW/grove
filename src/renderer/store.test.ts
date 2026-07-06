// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Store, type ProjectView } from './store'
import type { SessionSnapshot } from '../main/ipc'

// Minimal window.api stub. Each session-create returns a fresh unique id, exactly
// like the main-process registry — so a duplicate spawn is observable as two
// distinct sessions on one worktree (the non-durable symptom of the create→
// restore double-spawn bug).
function installApi(): { creates: SessionSnapshot[] } {
  let n = 0
  const creates: SessionSnapshot[] = []
  const api = {
    worktreeCreate: vi.fn(async (_root: string, opts: { branch: string }) => ({
      path: `/tmp/repo-wt-${opts.branch}`,
      branch: opts.branch
    })),
    sessionCreate: vi.fn(async (req: Record<string, unknown>) => {
      n += 1
      const snap = { ...req, id: `s${n}`, state: 'idle', pid: 1000 + n } as unknown as SessionSnapshot
      creates.push(snap)
      return snap
    }),
    layoutSave: vi.fn(),
    refreshWorktreeMeta: vi.fn()
  }
  // The store reads window.api.* directly.
  ;(globalThis as unknown as { window: { api: unknown } }).window = { api }
  return { creates }
}

function seedProject(store: Store): ProjectView {
  const project: ProjectView = {
    repoRoot: '/tmp/repo',
    name: 'repo',
    expanded: true,
    loaded: true,
    worktrees: new Map()
  }
  store.projects.set(project.repoRoot, project)
  store.activeProjectId = project.repoRoot
  // Silence the per-worktree metadata refresh (hits git via window.api).
  ;(store as unknown as { refreshWorktreeMeta: (id: string) => void }).refreshWorktreeMeta =
    () => {}
  return project
}

describe('createWorktree → open agent → re-select does not double-spawn', () => {
  beforeEach(() => {
    installApi()
  })

  it('opening an agent in a freshly-created worktree survives a later re-select with ONE session', async () => {
    const store = new Store()
    const project = seedProject(store)

    await store.createWorktree(project, 'feat')
    const wtId = '/tmp/repo-wt-feat'
    expect(store.activeWorktreeId).toBe(wtId)

    // Open an agent while the new worktree is active. This persists a layout
    // descriptor for the live session.
    await store.addSession(wtId, 'agent', {
      id: 'claude',
      name: 'Claude',
      command: 'claude',
      icon: '★'
    } as never)
    expect(store.sessionsOf(wtId)).toHaveLength(1)

    // Switch away and back — the pre-fix bug re-ran restoreWorktree over the
    // persisted descriptor and spawned the agent a SECOND time.
    await store.selectWorktree(project.repoRoot, wtId)

    expect(store.sessionsOf(wtId)).toHaveLength(1)
  })

  it('self-heals: a layout already corrupted with two descriptors sharing a durableKey restores ONE agent', async () => {
    const store = new Store()
    const project = seedProject(store)
    const wtId = '/tmp/repo-wt-feat'
    project.worktrees.set(wtId, { id: wtId, path: wtId, branch: 'feat', primary: false })

    // Simulate a layout.json corrupted by a past double-spawn: two agent
    // descriptors for one worktree that share a single durableKey (they would
    // both fold onto the same `tmux new-session -A`).
    const dup = {
      repoRoot: project.repoRoot,
      worktreePath: wtId,
      kind: 'agent' as const,
      title: 'claude',
      icon: '★',
      durable: true,
      durableKey: 'shared-key'
    }
    ;(store as unknown as { savedLayout: unknown[] }).savedLayout = [dup, { ...dup, title: 'claude 2' }]

    await store.selectWorktree(project.repoRoot, wtId)

    expect(store.sessionsOf(wtId)).toHaveLength(1)
  })
})
