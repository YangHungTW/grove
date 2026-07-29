// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Store, type ProjectView } from './store'
import { DEFAULT_SETTINGS } from '../core/settings'
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
    refreshWorktreeMeta: vi.fn(),
    settingsSave: vi.fn(async () => {}),
    projectRemove: vi.fn(async () => {}),
    closedAgentsSave: vi.fn()
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

  it('injects nothing when no skills are selected — byte-identical to the no-skills command', async () => {
    const { creates } = installApi()
    const store = new Store()
    const project = seedProject(store)

    await store.startTask(
      project,
      'task/fix-login',
      { id: 'claude', name: 'Claude', command: 'claude', icon: '★' } as never,
      "fix the 'login' bug",
      []
    )

    const cmd = (creates[0] as unknown as { command: string }).command
    // Exactly the assertion of the no-skills test above: passing an empty
    // selection must not perturb the launch command in any way.
    expect(cmd).toMatch(/^claude --session-id \S+ 'fix the '\\''login'\\'' bug'$/)
  })

  it('prepends /skill lines ahead of the task text when skills are selected', async () => {
    const { creates } = installApi()
    const store = new Store()
    const project = seedProject(store)

    await store.startTask(
      project,
      'task/fix-login',
      { id: 'claude', name: 'Claude', command: 'claude', icon: '★' } as never,
      'fix the bug',
      ['foo', 'bar']
    )

    const cmd = (creates[0] as unknown as { command: string }).command
    expect(cmd).toContain('/foo')
    expect(cmd).toContain('/bar')
    // Order matters: skills must be invoked BEFORE the task is described.
    expect(cmd.indexOf('/foo')).toBeLessThan(cmd.indexOf('fix the bug'))
    expect(cmd.indexOf('/foo')).toBeLessThan(cmd.indexOf('/bar'))
    // Still one shell-quoted positional argument, newlines and all.
    expect(cmd).toMatch(/^claude --session-id \S+ '\/foo\n\/bar\nfix the bug'$/)
  })

  it('uses the agent CLI’s own invocation token', async () => {
    const { creates } = installApi()
    const store = new Store()
    const project = seedProject(store)

    await store.startTask(
      project,
      'task/x',
      { id: 'codex', name: 'Codex', command: 'codex', icon: '★' } as never,
      'do it',
      ['review']
    )

    // codex has no --session-id (not a claude-family CLI), and invokes with $.
    expect((creates[0] as unknown as { command: string }).command).toBe("codex '$review\ndo it'")
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

describe('renderer-atlas plumbing (stale-glyph / doubled status-row fix)', () => {
  beforeEach(() => {
    installApi()
  })

  it('clearPaneAtlas drops the registered renderer addon’s glyph cache', () => {
    const store = new Store()
    const pane = fakePane()
    store.registerPane('s1', pane.term as never, pane.fit as never)
    const clearTextureAtlas = vi.fn()
    store.setRenderAddon('s1', { clearTextureAtlas })

    store.clearPaneAtlas('s1')
    expect(clearTextureAtlas).toHaveBeenCalledTimes(1)
  })

  it('after setRenderAddon(null) — e.g. renderer swap/unmount — clearing is a no-op', () => {
    const store = new Store()
    const pane = fakePane()
    store.registerPane('s1', pane.term as never, pane.fit as never)
    const clearTextureAtlas = vi.fn()
    store.setRenderAddon('s1', { clearTextureAtlas })
    store.setRenderAddon('s1', null)

    expect(() => store.clearPaneAtlas('s1')).not.toThrow()
    expect(clearTextureAtlas).not.toHaveBeenCalled()
  })

  it('re-registering a pane (a re-render) keeps its renderer addon', () => {
    const store = new Store()
    const a = fakePane()
    const b = fakePane()
    store.registerPane('s1', a.term as never, a.fit as never)
    const clearTextureAtlas = vi.fn()
    store.setRenderAddon('s1', { clearTextureAtlas })
    // <Pane> can re-run registerPane without the renderer effect re-firing; the
    // addon reference must survive so clears still reach the live renderer.
    store.registerPane('s1', b.term as never, b.fit as never)

    store.clearPaneAtlas('s1')
    expect(clearTextureAtlas).toHaveBeenCalledTimes(1)
  })
})

describe('repaintAllPanes (blank pane after window occlusion)', () => {
  beforeEach(() => {
    installApi()
  })

  it('clears the atlas and fully refreshes every registered pane', () => {
    const store = new Store()
    const a = fakePane()
    const b = fakePane()
    store.registerPane('s1', a.term as never, a.fit as never)
    store.registerPane('s2', b.term as never, b.fit as never)
    const clearA = vi.fn()
    const clearB = vi.fn()
    store.setRenderAddon('s1', { clearTextureAtlas: clearA })
    store.setRenderAddon('s2', { clearTextureAtlas: clearB })

    store.repaintAllPanes()

    // Coming back from occlusion, the GPU may have dropped the glyph textures
    // too — a plain refresh would redraw from a stale atlas.
    expect(clearA).toHaveBeenCalledTimes(1)
    expect(clearB).toHaveBeenCalledTimes(1)
    // Full range, not a partial row span: the whole canvas is gone.
    expect(a.term.refresh).toHaveBeenCalledWith(0, 23)
    expect(b.term.refresh).toHaveBeenCalledWith(0, 23)
  })

  it('repaints panes that have no renderer addon (DOM fallback) without throwing', () => {
    const store = new Store()
    const pane = fakePane()
    store.registerPane('s1', pane.term as never, pane.fit as never)

    expect(() => store.repaintAllPanes()).not.toThrow()
    expect(pane.term.refresh).toHaveBeenCalledWith(0, 23)
  })

  it('is a no-op with no panes registered', () => {
    const store = new Store()
    expect(() => store.repaintAllPanes()).not.toThrow()
  })

  it('uses each pane’s own row count', () => {
    const store = new Store()
    const pane = fakePane()
    pane.term.resize(100, 40)
    store.registerPane('s1', pane.term as never, pane.fit as never)

    store.repaintAllPanes()
    expect(pane.term.refresh).toHaveBeenLastCalledWith(0, 39)
  })
})

describe('scheduleScrollRepaint (blank pane after scrolling past the buffer end)', () => {
  beforeEach(() => {
    installApi()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the atlas and fully refreshes the wheeled pane', () => {
    const store = new Store()
    const pane = fakePane()
    store.registerPane('s1', pane.term as never, pane.fit as never)
    const clear = vi.fn()
    store.setRenderAddon('s1', { clearTextureAtlas: clear })

    store.scheduleScrollRepaint('s1')
    // Trailing edge: nothing repaints while the gesture is still going.
    expect(pane.term.refresh).not.toHaveBeenCalled()
    vi.runAllTimers()

    expect(clear).toHaveBeenCalledTimes(1)
    expect(pane.term.refresh).toHaveBeenCalledWith(0, 23)
  })

  it('coalesces a burst of wheel events into one repaint', () => {
    const store = new Store()
    const pane = fakePane()
    store.registerPane('s1', pane.term as never, pane.fit as never)

    // A trackpad flick delivers dozens of wheel events; each must not cost a
    // full-canvas repaint.
    for (let i = 0; i < 30; i++) store.scheduleScrollRepaint('s1')
    vi.runAllTimers()

    expect(pane.term.refresh).toHaveBeenCalledTimes(1)
  })

  it('leaves other panes alone', () => {
    const store = new Store()
    const a = fakePane()
    const b = fakePane()
    store.registerPane('s1', a.term as never, a.fit as never)
    store.registerPane('s2', b.term as never, b.fit as never)

    store.scheduleScrollRepaint('s1')
    vi.runAllTimers()

    expect(a.term.refresh).toHaveBeenCalledTimes(1)
    expect(b.term.refresh).not.toHaveBeenCalled()
  })

  it('does not throw when the pane is disposed before the timer fires', () => {
    const store = new Store()
    const pane = fakePane()
    store.registerPane('s1', pane.term as never, pane.fit as never)

    store.scheduleScrollRepaint('s1')
    store.unregisterPane('s1')

    expect(() => vi.runAllTimers()).not.toThrow()
    expect(pane.term.refresh).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Collapsible sidebar projects
// ---------------------------------------------------------------------------

// Captured at module load, BEFORE any beforeEach replaces globalThis.window
// with a bare { api } object — init() needs a real window (addEventListener).
const jsdomWindow = globalThis.window

function seedSecondProject(store: Store): ProjectView {
  const project: ProjectView = {
    repoRoot: '/tmp/other',
    name: 'other',
    expanded: true,
    loaded: true,
    worktrees: new Map()
  }
  store.projects.set(project.repoRoot, project)
  return project
}

/** Last collapsedProjects patch handed to settingsSave, or undefined. */
function lastCollapsed(api: Record<string, ReturnType<typeof vi.fn>>): string[] | undefined {
  const calls = api.settingsSave.mock.calls
  for (let i = calls.length - 1; i >= 0; i--) {
    const patch = calls[i][0] as { collapsedProjects?: string[] }
    if (patch && 'collapsedProjects' in patch) return patch.collapsedProjects
  }
  return undefined
}

describe('sidebar project collapse', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>
  beforeEach(() => {
    api = installApi().api
  })

  it('toggling collapses the project and persists its repoRoot', async () => {
    const store = new Store()
    const project = seedProject(store)
    expect(project.expanded).toBe(true)

    store.toggleProjectExpand(project.repoRoot)

    expect(project.expanded).toBe(false)
    expect(lastCollapsed(api)).toContain('/tmp/repo')
  })

  it('toggling back expands it and removes it from the persisted set', async () => {
    const store = new Store()
    const project = seedProject(store)

    store.toggleProjectExpand(project.repoRoot)
    store.toggleProjectExpand(project.repoRoot)

    expect(project.expanded).toBe(true)
    expect(lastCollapsed(api)).not.toContain('/tmp/repo')
    expect(lastCollapsed(api)).toEqual([])
  })

  it('collapseAllProjects collapses every project in ONE settings write', () => {
    const store = new Store()
    const a = seedProject(store)
    const b = seedSecondProject(store)
    api.settingsSave.mockClear()

    store.collapseAllProjects()

    expect(a.expanded).toBe(false)
    expect(b.expanded).toBe(false)
    expect(api.settingsSave).toHaveBeenCalledTimes(1)
    expect(lastCollapsed(api)).toEqual(['/tmp/repo', '/tmp/other'])
  })

  it('expandAllProjects expands every project and clears the persisted set', () => {
    const store = new Store()
    const a = seedProject(store)
    const b = seedSecondProject(store)
    store.collapseAllProjects()
    api.settingsSave.mockClear()

    store.expandAllProjects()

    expect(a.expanded).toBe(true)
    expect(b.expanded).toBe(true)
    expect(api.settingsSave).toHaveBeenCalledTimes(1)
    expect(lastCollapsed(api)).toEqual([])
  })

  it('anyProjectExpanded drives the Collapse-all / Expand-all label', () => {
    const store = new Store()
    seedProject(store)
    seedSecondProject(store)
    expect(store.anyProjectExpanded()).toBe(true)
    store.collapseAllProjects()
    expect(store.anyProjectExpanded()).toBe(false)
  })

  it('selecting a collapsed project does not re-expand it, and neither does a reconcile', async () => {
    const store = new Store()
    const project = seedProject(store)
    store.toggleProjectExpand(project.repoRoot)
    expect(project.expanded).toBe(false)

    await store.setActiveProject(project.repoRoot)
    expect(store.projects.get('/tmp/repo')!.expanded).toBe(false)

    // The 20s meta poll / window-focus reconcile must not disturb collapse state.
    api.worktreeList = vi.fn(async () => [{ path: '/tmp/repo', branch: 'main' }])
    await store.reconcileAllWorktrees()
    expect(store.projects.get('/tmp/repo')!.expanded).toBe(false)
    expect(lastCollapsed(api)).toContain('/tmp/repo')
  })

  it('closing a collapsed project drops it from the persisted set, so reopening starts expanded', async () => {
    const store = new Store()
    const project = seedProject(store)
    seedSecondProject(store)
    store.toggleProjectExpand(project.repoRoot)
    expect(lastCollapsed(api)).toContain('/tmp/repo')

    await store.removeProject(project.repoRoot)

    // Stale roots here would silently re-collapse the folder on reopen.
    expect(lastCollapsed(api)).not.toContain('/tmp/repo')
    const reopened = (
      store as unknown as { upsertProject: (r: string, n: string) => ProjectView }
    ).upsertProject('/tmp/repo', 'repo')
    expect(reopened.expanded).toBe(true)
  })

  it('init() rehydrates a persisted collapse instead of force-expanding at boot', async () => {
    const initApi: Record<string, unknown> = {
      settingsLoad: vi.fn(async () => ({
        ...DEFAULT_SETTINGS,
        collapsedProjects: ['/x']
      })),
      agentsAvailable: vi.fn(async () => []),
      layoutLoad: vi.fn(async () => []),
      closedAgentsLoad: vi.fn(async () => []),
      projectListRecent: vi.fn(async () => [{ repoRoot: '/x', name: 'x' }]),
      repoRoot: vi.fn(async () => '/x'),
      projectAdd: vi.fn(async () => ({ repoRoot: '/x', name: 'x' })),
      worktreeList: vi.fn(async () => []),
      settingsSave: vi.fn(async () => {}),
      setBadgeCount: vi.fn()
    }
    // Unlisted members (the onSessionData/onSessionExit/… listener registrations)
    // resolve to no-op mocks rather than being hand-listed.
    const api = new Proxy(initApi, {
      get: (t, k: string) => (k in t ? t[k] : vi.fn())
    })
    ;(globalThis as unknown as { window: unknown }).window = jsdomWindow
    ;(jsdomWindow as unknown as { api: unknown }).api = api
    // jsdom has no FontFaceSet; init() awaits document.fonts.load twice.
    Object.defineProperty(jsdomWindow.document, 'fonts', {
      value: { load: async () => [] },
      configurable: true
    })

    const store = new Store()
    await store.init()

    expect(store.projects.get('/x')!.expanded).toBe(false)
  })
})
