// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Store, type ProjectView } from './store'
import type { SessionSnapshot } from '../main/ipc'

// Minimal window.api stub. Each session-create returns a fresh unique id, exactly
// like the main-process registry — so a duplicate spawn is observable as two
// distinct sessions on one worktree (the non-durable symptom of the create→
// restore double-spawn bug).
function installApi(): { creates: SessionSnapshot[]; api: Record<string, ReturnType<typeof vi.fn>> } {
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
    sessionResize: vi.fn(),
    setBadgeCount: vi.fn(),
    layoutSave: vi.fn(),
    refreshWorktreeMeta: vi.fn()
  }
  // The store reads window.api.* directly.
  ;(globalThis as unknown as { window: { api: unknown } }).window = { api }
  return { creates, api }
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

describe('startTask (New task flow)', () => {
  it('creates the worktree and launches the agent with the prompt as a quoted argument', async () => {
    const { creates } = installApi()
    const store = new Store()
    const project = seedProject(store)

    await store.startTask(
      project,
      'task/fix-login',
      { id: 'claude', name: 'Claude', command: 'claude', icon: '★' } as never,
      "fix the 'login' bug"
    )

    expect(store.sessionsOf('/tmp/repo-wt-task/fix-login')).toHaveLength(1)
    const cmd = (creates[0] as unknown as { command: string }).command
    // claude --session-id <uuid> 'fix the '\''login'\'' bug'
    expect(cmd).toMatch(/^claude --session-id \S+ 'fix the '\\''login'\\'' bug'$/)
  })

  it('does not launch an agent when the worktree was not created (e.g. branch exists)', async () => {
    const { creates, api } = installApi()
    api.worktreeCreate.mockRejectedValue(new Error('BRANCH_EXISTS'))
    const store = new Store()
    const project = seedProject(store)

    await store.startTask(
      project,
      'task/dup',
      { id: 'claude', name: 'Claude', command: 'claude', icon: '★' } as never,
      'anything'
    )

    expect(creates).toHaveLength(0)
    expect(store.dialog?.kind).toBe('branchExists') // createWorktree's own recovery UI
  })
})

// A stand-in for what <Pane> registers: a terminal + the pane's own refit.
// term.resize mirrors xterm (updates cols/rows) so the bounce logic in
// fitVisible reads back what it wrote.
function fakePane(): {
  term: { cols: number; rows: number } & Record<string, ReturnType<typeof vi.fn>>
  fit: { fit: ReturnType<typeof vi.fn> }
  refit: ReturnType<typeof vi.fn>
} {
  const term = {
    cols: 80,
    rows: 24,
    resize: vi.fn((c: number, r: number) => {
      term.cols = c
      term.rows = r
    }),
    refresh: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn()
  }
  return { term: term as never, fit: { fit: vi.fn() }, refit: vi.fn() }
}

describe('pane sizing goes through the pane-registered refit', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>
  beforeEach(() => {
    api = installApi().api
    // fitVisible defers to the next frame; run it synchronously in tests.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
  })

  async function seedAgentSession(store: Store): Promise<{ wtId: string; id: string }> {
    const project = seedProject(store)
    const wtId = '/tmp/repo-wt-feat'
    project.worktrees.set(wtId, { id: wtId, path: wtId, branch: 'feat', primary: false })
    // First select marks the worktree restored (no saved layout yet), so a later
    // re-select won't respawn the live session under a fresh id.
    await store.selectWorktree(project.repoRoot, wtId)
    await store.addSession(wtId, 'agent', {
      id: 'claude',
      name: 'Claude',
      command: 'claude',
      icon: '★'
    } as never)
    return { wtId, id: store.sessionsOf(wtId)[0].id }
  }

  it('fitVisible sizes panes via their registered refit, never fit.fit()', async () => {
    const store = new Store()
    const { id } = await seedAgentSession(store)
    const pane = fakePane()
    store.registerPane(id, pane.term as never, pane.fit as never, undefined, pane.refit)

    store.fitVisible()

    expect(pane.refit).toHaveBeenCalled()
    // fit.fit() sized the terminal one row taller than the pane's own refit
    // (no reserved bottom row) — the two paths must not disagree.
    expect(pane.fit.fit).not.toHaveBeenCalled()
  })

  it('selectWorktree nudges newly-shown agent panes (rows-1 → rows bounce reaches the pty)', async () => {
    const store = new Store()
    const { wtId, id } = await seedAgentSession(store)
    const pane = fakePane()
    store.registerPane(id, pane.term as never, pane.fit as never, undefined, pane.refit)

    await store.selectWorktree('/tmp/repo', wtId)

    expect(pane.refit).toHaveBeenCalled()
    expect(api.sessionResize).toHaveBeenCalledWith(id, 80, 23)
    expect(api.sessionResize).toHaveBeenCalledWith(id, 80, 24)
  })

  it('a tab switch nudges panes; refocusing the already-active tab does not', async () => {
    const store = new Store()
    const { wtId, id: first } = await seedAgentSession(store)
    await store.addSession(wtId, 'agent', {
      id: 'claude',
      name: 'Claude',
      command: 'claude',
      icon: '★'
    } as never)
    const paneA = fakePane()
    const paneB = fakePane()
    const second = store.sessionsOf(wtId)[1].id
    store.registerPane(first, paneA.term as never, paneA.fit as never, undefined, paneA.refit)
    store.registerPane(second, paneB.term as never, paneB.fit as never, undefined, paneB.refit)

    store.focusSession(first) // second was active (added last) → real tab switch
    expect(paneA.refit).toHaveBeenCalled()

    paneA.refit.mockClear()
    store.focusSession(first) // already active — a plain refocus click
    expect(paneA.refit).not.toHaveBeenCalled()
  })
})
