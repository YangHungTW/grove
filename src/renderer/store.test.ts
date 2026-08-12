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
    sessionKill: vi.fn(),
    setBadgeCount: vi.fn(),
    layoutSave: vi.fn(),
    refreshWorktreeMeta: vi.fn(),
    settingsSave: vi.fn(async () => {}),
    projectRemove: vi.fn(async () => {}),
    closedAgentsSave: vi.fn(),
    // Subscriptions wireEvents() installs; tests drive them by grabbing the
    // handler off the mock's calls.
    onSessionData: vi.fn(),
    onSessionState: vi.fn(),
    onSessionExit: vi.fn(),
    onNotifyJump: vi.fn(),
    onHookFailed: vi.fn(),
    onFleetChange: vi.fn(),
    onMcpSpawn: vi.fn(),
    mcpSpawnResult: vi.fn(),
    fleetList: vi.fn(async () => []),
    // Grove's MCP server is optional at launch; null is the "not running" path.
    mcpLaunch: vi.fn(async () => null)
  }
  // The store reads window.api.* directly. Augment jsdom's window rather than
  // replacing it — the store also uses window.setTimeout/clearTimeout, which a
  // bare `{ api }` stub would strip.
  const g = globalThis as unknown as { window?: Record<string, unknown> }
  ;(g.window ??= {}).api = api
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
    dispose: vi.fn(),
    // Enough of the write/read surface for the onSessionData path: xterm parses
    // asynchronously and calls back, and the store then reads the resolved row.
    write: vi.fn((_data: string, cb?: () => void) => cb?.()),
    buffer: { active: { baseY: 0, getLine: () => ({ translateToString: () => 'status row' }) } }
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

  it('nudges the agent only on the FIRST show, then repaints locally', async () => {
    // The rows-1→rows bounce SIGWINCHes the agent into redrawing its whole UI.
    // Doing that on every reveal is what made switching tabs visibly re-render
    // the pane. xterm keeps processing output while a pane is hidden, so on a
    // later reveal its buffer is already correct and only the canvas is stale.
    const store = new Store()
    const { wtId, id } = await seedAgentSession(store)
    const pane = fakePane()
    store.registerPane(id, pane.term as never, pane.fit as never, undefined, pane.refit)

    await store.selectWorktree('/tmp/repo', wtId) // first show → nudge
    api.sessionResize.mockClear()
    pane.term.refresh.mockClear()

    // Hide it, then reveal it again the way a tab switch does.
    store.activeWorktreeId = '/tmp/other-wt'
    store.fitVisible()
    store.activeWorktreeId = wtId
    store.fitVisible()

    expect(pane.term.refresh).toHaveBeenCalled()
    // No SIGWINCH: refit() above still resizes the pty if the geometry moved,
    // but an unchanged size must not reach the agent at all.
    expect(api.sessionResize).not.toHaveBeenCalled()
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

describe('a collapsed project must not hide the worktree being selected', () => {
  beforeEach(() => {
    installApi()
  })

  /** A store holding `roots`, each with one worktree, all collapsed — the state
   * a restart rehydrates from settings.collapsedProjects. */
  function collapsedProjects(store: Store, roots: string[]): void {
    store.settings = { ...store.settings, collapsedProjects: [...roots] }
    for (const repoRoot of roots) {
      const project: ProjectView = {
        repoRoot,
        name: repoRoot,
        expanded: false,
        loaded: true,
        worktrees: new Map([[`${repoRoot}/wt`, { id: `${repoRoot}/wt`, path: `${repoRoot}/wt`, branch: 'main', primary: true }]])
      }
      store.projects.set(repoRoot, project)
    }
    ;(store as unknown as { refreshWorktreeMeta: (id: string) => void }).refreshWorktreeMeta =
      () => {}
    ;(store as unknown as { restoreWorktree: (id: string) => Promise<void> }).restoreWorktree =
      async () => {}
  }

  it('opens the project the boot selection lands in', async () => {
    // The reported bug: restart came up with tabs on a worktree whose project
    // was collapsed, so the sidebar showed nothing for the session in front of
    // you. init() picks the launch project's first worktree via setActiveProject.
    const store = new Store()
    collapsedProjects(store, ['/tmp/a'])

    await store.setActiveProject('/tmp/a')

    expect(store.projects.get('/tmp/a')?.expanded).toBe(true)
    expect(store.activeWorktreeId).toBe('/tmp/a/wt')
  })

  it('leaves every other collapsed project alone', async () => {
    const store = new Store()
    collapsedProjects(store, ['/tmp/a', '/tmp/b'])

    await store.setActiveProject('/tmp/a')

    expect(store.projects.get('/tmp/b')?.expanded).toBe(false)
    expect(store.settings.collapsedProjects).toEqual(['/tmp/b'])
  })

  it('opens a collapsed project reached by keyboard worktree switch', async () => {
    // switchWorktree/cycleWorktree can select into a project no card is visible
    // in; clicking a card never can.
    const store = new Store()
    collapsedProjects(store, ['/tmp/a'])

    await store.selectWorktree('/tmp/a', '/tmp/a/wt')

    expect(store.projects.get('/tmp/a')?.expanded).toBe(true)
  })

  it('still lets you collapse the project you are working in', async () => {
    // The reveal is on selection, not on state — otherwise the caret would fight
    // you on the one project you are most likely to want out of the way.
    const store = new Store()
    collapsedProjects(store, ['/tmp/a'])
    await store.setActiveProject('/tmp/a')

    store.toggleProjectExpand('/tmp/a')

    expect(store.projects.get('/tmp/a')?.expanded).toBe(false)
    expect(store.settings.collapsedProjects).toEqual(['/tmp/a'])
  })
})

describe('atlas clear under sustained output (garbled cost row while an agent runs)', () => {
  /** A store with `ids` as panes of the active worktree — visible unless
   * `hidden`, which parks them on a worktree that isn't selected. Returns each
   * pane's clearTextureAtlas spy and a "pty emitted a chunk" function. */
  function streamingPanes(
    ids: string[],
    { hidden = false } = {}
  ): {
    store: Store
    clears: Record<string, ReturnType<typeof vi.fn>>
    emit: (id: string) => void
  } {
    const { api } = installApi()
    const store = new Store()
    const wtId = '/tmp/repo-wt'
    const clears: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const id of ids) {
      const pane = fakePane()
      store.sessions.set(id, { id, worktreeId: wtId, kind: 'agent' } as never)
      store.registerPane(id, pane.term as never, pane.fit as never)
      clears[id] = vi.fn()
      store.setRenderAddon(id, { clearTextureAtlas: clears[id] })
    }
    // One group per session, so every pane is its group's active (= visible) one.
    store.groupsByWt.set(
      wtId,
      ids.map((id) => ({ ids: [id], active: id }))
    )
    store.activeWorktreeId = hidden ? '/tmp/other-wt' : wtId
    store.wireEvents()
    const onData = api.onSessionData.mock.calls[0][0] as (e: { id: string; data: string }) => void
    return { store, clears, emit: (id) => onData({ id, data: 'cost: $5.03\r' }) }
  }

  function streamingPane(): { clearTextureAtlas: ReturnType<typeof vi.fn>; emit: () => void } {
    const { clears, emit } = streamingPanes(['s1'])
    return { clearTextureAtlas: clears.s1, emit: () => emit('s1') }
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does NOT clear while a pane is streaming — deliberately', () => {
    const { clearTextureAtlas, emit } = streamingPane()
    // A live agent: one chunk every 50ms for a second, all inside the 180ms
    // settle window. 0.9.2 made the clear fire ~2.5x a second here, to try to
    // repair a garbled cost row; it did not (that is a fault in xterm's WebGL
    // renderer), and it charged every streaming pane a full glyph
    // re-rasterization several times a second for nothing. Assert the absence so
    // the cap is not reintroduced on the same disproven theory.
    for (let i = 0; i < 20; i++) {
      emit()
      vi.advanceTimersByTime(50)
    }
    expect(clearTextureAtlas).not.toHaveBeenCalled()
  })

  it('clears once when a burst finally ends, not once per chunk', () => {
    const { clearTextureAtlas, emit } = streamingPane()
    for (let i = 0; i < 20; i++) {
      emit()
      vi.advanceTimersByTime(50)
    }
    vi.advanceTimersByTime(200)
    expect(clearTextureAtlas).toHaveBeenCalledTimes(1)
  })

  it('still clears promptly once output settles', () => {
    const { clearTextureAtlas, emit } = streamingPane()
    emit()
    vi.advanceTimersByTime(179)
    expect(clearTextureAtlas).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(clearTextureAtlas).toHaveBeenCalledTimes(1)
  })

  it('skips a pane on a worktree that is not on screen', () => {
    const { clears, emit } = streamingPanes(['s1'], { hidden: true })
    emit('s1')
    vi.advanceTimersByTime(1000)
    // A background agent keeps producing output; nothing is drawing its pane, so
    // re-rasterizing its glyphs is work no one sees. <Pane> clears on reshow.
    expect(clears.s1).not.toHaveBeenCalled()
  })

  it('debounces each pane on its own output, not on the busiest pane’s', () => {
    const { clears, emit } = streamingPanes(['s1', 's2'])
    // s1 goes quiet while s2 keeps streaming. With one timer shared across panes
    // — as this used to be — s2's chunks kept resetting it, so s1's clear was
    // held hostage by a pane that had nothing to do with it.
    emit('s1')
    for (let i = 0; i < 6; i++) {
      emit('s2')
      vi.advanceTimersByTime(50)
    }
    expect(clears.s1).toHaveBeenCalledTimes(1)
    expect(clears.s2).not.toHaveBeenCalled()
  })

  it('drops a pane’s pending clear when it is torn down', () => {
    const { store, clears, emit } = streamingPanes(['s1'])
    emit('s1')
    store.unregisterPane('s1')
    vi.advanceTimersByTime(1000)
    expect(clears.s1).not.toHaveBeenCalled()
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
      // Listed rather than left to the catch-all below: init awaits this one, and
      // a bare no-op mock returns undefined rather than a promise.
      fleetList: vi.fn(async () => []),
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

// Claude reports WHY it is waiting ("dialog open", "sandbox request"…) in its
// own session registry; main forwards it on the state event. The reason is only
// meaningful while waiting — a stale one left on an idle tab reads as a bug.
describe('waitingFor rides along with the state event', () => {
  function wired(): {
    store: Store
    emit: (e: { id: string; state: string; waitingFor?: string }) => void
  } {
    const { api } = installApi()
    const store = new Store()
    const wtId = '/tmp/repo-wt-feat'
    store.sessions.set('s1', {
      id: 's1',
      worktreeId: wtId,
      kind: 'agent',
      title: 'claude',
      state: 'idle'
    } as never)
    store.focusedSessionId = 's1' // suppress the toast/notify attention path
    store.wireEvents()
    const onState = api.onSessionState.mock.calls[0][0]
    return { store, emit: onState as never }
  }

  it('records the reason on a waiting state and exposes it per worktree', () => {
    const { store, emit } = wired()
    emit({ id: 's1', state: 'waiting', waitingFor: 'dialog open' })
    expect(store.sessions.get('s1')!.waitingFor).toBe('dialog open')
    expect(store.worktreeWaitingFor('/tmp/repo-wt-feat')).toBe('dialog open')
  })

  it('clears the reason once the session stops waiting', () => {
    const { store, emit } = wired()
    emit({ id: 's1', state: 'waiting', waitingFor: 'sandbox request' })
    emit({ id: 's1', state: 'busy' })
    expect(store.sessions.get('s1')!.waitingFor).toBeUndefined()
    expect(store.worktreeWaitingFor('/tmp/repo-wt-feat')).toBeUndefined()
  })
})

// mcp__grove__spawn_agent: main forwards an agent's spawn request; the renderer
// creates the pane and answers with its id. Delegation is a background act — it
// must never yank the user's active worktree or keyboard focus.
describe('onMcpSpawn (spawn_agent round-trip)', () => {
  async function wired(): Promise<{
    store: Store
    api: Record<string, ReturnType<typeof vi.fn>>
    spawn: (e: { requestId: string; worktree: string; prompt: string; title?: string }) => Promise<void>
  }> {
    const { api } = installApi()
    const store = new Store()
    const project = seedProject(store)
    for (const wtId of ['/tmp/repo-wt-a', '/tmp/repo-wt-b'])
      project.worktrees.set(wtId, { id: wtId, path: wtId, branch: wtId.slice(-1), primary: false })
    await store.selectWorktree(project.repoRoot, '/tmp/repo-wt-a')
    store.availableAgents = [
      { id: 'claude', name: 'Claude', command: 'claude', icon: '★', installed: true }
    ] as never
    store.wireEvents()
    const handler = api.onMcpSpawn.mock.calls[0][0] as (e: unknown) => Promise<void>
    return { store, api, spawn: handler as never }
  }

  it('creates the pane in the requested worktree and answers with its id', async () => {
    const { api, spawn } = await wired()
    await spawn({ requestId: 'r1', worktree: '/tmp/repo-wt-b', prompt: 'do the thing' })
    const req = api.sessionCreate.mock.calls.at(-1)![0] as Record<string, string>
    expect(req.worktreeId).toBe('/tmp/repo-wt-b')
    expect(req.command).toContain("'do the thing'") // prompt rides as the task argument
    const [id, result] = api.mcpSpawnResult.mock.calls.at(-1)!
    expect(id).toBe('r1')
    expect((result as { paneId?: string }).paneId).toBeTruthy()
  })

  it('does NOT steal the active worktree or focus', async () => {
    const { store, spawn } = await wired()
    const focusBefore = store.focusedSessionId
    await spawn({ requestId: 'r2', worktree: '/tmp/repo-wt-b', prompt: 'background work' })
    expect(store.activeWorktreeId).toBe('/tmp/repo-wt-a')
    expect(store.focusedSessionId).toBe(focusBefore)
    // The pane exists and is persisted — it's just not shoved into view.
    expect(store.sessionsOf('/tmp/repo-wt-b')).toHaveLength(1)
  })

  it('answers with an error for a worktree Grove has not opened', async () => {
    const { api, spawn } = await wired()
    api.sessionCreate.mockClear()
    await spawn({ requestId: 'r3', worktree: '/not/open', prompt: 'x' })
    expect(api.sessionCreate).not.toHaveBeenCalled()
    const [, result] = api.mcpSpawnResult.mock.calls.at(-1)!
    expect((result as { error?: string }).error).toContain('/not/open')
  })
})

// Attaching a background fleet session (`claude attach <jobId>`) pulls it into a
// Grove pane. The pane is a WINDOW onto a daemon-owned process, which shapes
// everything: it joins the registry by the session's existing uuid, and it must
// never be persisted — a layout-restore would spawn a brand-new claude in its
// place instead of reattaching.
describe('attachFleetSession', () => {
  const FLEET = {
    pid: 1,
    sessionId: 'fleet-uuid',
    cwd: '/tmp/repo-wt-feat/src',
    kind: 'bg' as const,
    jobId: 'a8e23050',
    name: 'stray',
    status: 'busy' as const
  }

  async function seeded(): Promise<{ store: Store; api: Record<string, ReturnType<typeof vi.fn>> }> {
    const { api } = installApi()
    const store = new Store()
    const project = seedProject(store)
    const wtId = '/tmp/repo-wt-feat'
    project.worktrees.set(wtId, { id: wtId, path: wtId, branch: 'feat', primary: false })
    await store.selectWorktree(project.repoRoot, wtId)
    return { store, api }
  }

  it('runs claude attach in the worktree containing the session cwd, joined by its uuid', async () => {
    const { store, api } = await seeded()
    await store.attachFleetSession(FLEET as never)
    const req = api.sessionCreate.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(req.worktreeId).toBe('/tmp/repo-wt-feat')
    expect(req.command).toBe("claude attach 'a8e23050'")
    expect(req.agentSessionId).toBe('fleet-uuid') // registry state from first paint
    expect(req.cwd).toBe('/tmp/repo-wt-feat/src')
  })

  it('never persists the attach pane to the layout', async () => {
    const { store, api } = await seeded()
    await store.attachFleetSession(FLEET as never)
    const saved = (api.layoutSave.mock.calls.at(-1)?.[0] ?? []) as { title: string }[]
    expect(saved.some((d) => d.title === 'stray')).toBe(false)
  })

  it('declines when no open worktree contains the session cwd', async () => {
    const { store, api } = await seeded()
    api.sessionCreate.mockClear()
    await store.attachFleetSession({ ...FLEET, cwd: '/somewhere/else' } as never)
    expect(api.sessionCreate).not.toHaveBeenCalled()
  })

  it('declines a session with no job id — interactive sessions are not attachable', async () => {
    const { store, api } = await seeded()
    api.sessionCreate.mockClear()
    await store.attachFleetSession({ ...FLEET, jobId: undefined } as never)
    expect(api.sessionCreate).not.toHaveBeenCalled()
  })
})

// Closing a tab used to only DETACH a durable (tmux) agent: the control client
// died, the agent kept running forever. Nothing ever reaped those, so a day of
// opening and closing tabs left a pile of live agent processes behind.
describe('closing a tab terminates a durable agent (no background leak)', () => {
  async function openAgent(): Promise<{ store: Store; api: Record<string, ReturnType<typeof vi.fn>>; wtId: string }> {
    const { api } = installApi()
    const store = new Store()
    const project = seedProject(store)
    await store.createWorktree(project, 'feat')
    const wtId = '/tmp/repo-wt-feat'
    await store.addSession(wtId, 'agent', {
      id: 'claude',
      name: 'Claude',
      command: 'claude',
      icon: '★'
    } as never)
    return { store, api, wtId }
  }

  it('closeSession kills without the detach flag — the tmux session goes away', async () => {
    const { store, api, wtId } = await openAgent()
    const id = store.sessionsOf(wtId)[0].id

    store.closeSession(id)

    expect(api.sessionKill).toHaveBeenCalledWith(id, false)
    expect(store.sessionsOf(wtId)).toHaveLength(0)
  })

  it('hands the durableKey to the MCP mint, so durable tickets can persist', async () => {
    const { store, api, wtId } = await openAgent()
    expect(api.mcpLaunch).toHaveBeenCalledTimes(1)
    // The key passed to mcpLaunch must be the SAME stable id the session was
    // created with — it is what a restarted Grove uses to find the ticket the
    // still-running tmux process is presenting.
    const minted = api.mcpLaunch.mock.calls[0][0]
    const created = api.sessionCreate.mock.calls.at(-1)![0] as { durableKey?: string }
    expect(minted).toBeTruthy()
    expect(created.durableKey).toBe(minted)
    void store
    void wtId
  })

  it('detachSession is the explicit opt-out and leaves the agent running', async () => {
    const { store, api, wtId } = await openAgent()
    const id = store.sessionsOf(wtId)[0].id

    store.detachSession(id)

    expect(api.sessionKill).toHaveBeenCalledWith(id, true)
    expect(store.sessionsOf(wtId)).toHaveLength(0)
  })

  it('bulk teardown (removing the worktree) terminates too — nothing is left detached', async () => {
    const { store, api, wtId } = await openAgent()
    const project = store.projects.get('/tmp/repo')!
    project.worktrees.set(wtId, { id: wtId, path: wtId, branch: 'feat', primary: false })
    const id = store.sessionsOf(wtId)[0].id

    await store.removeWorktree(project, wtId)

    expect(api.sessionKill).toHaveBeenCalledWith(id, false)
  })
})
