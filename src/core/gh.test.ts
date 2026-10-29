import { describe, expect, it, beforeEach } from 'vitest'
import {
  parsePrView,
  parseGhResolve,
  prStatus,
  resetPrCache,
  summarizeChecks,
  PR_CACHE_TTL_MS,
  type Runner
} from './gh'

describe('summarizeChecks', () => {
  it('returns none for an empty rollup', () => {
    expect(summarizeChecks([])).toBe('none')
    expect(summarizeChecks(null)).toBe('none')
  })

  it('passes when every CheckRun completed successfully (or was skipped)', () => {
    expect(
      summarizeChecks([
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'NEUTRAL' }
      ])
    ).toBe('pass')
  })

  it('fails on any failed run, even with others pending', () => {
    expect(
      summarizeChecks([
        { __typename: 'CheckRun', status: 'IN_PROGRESS' },
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }
      ])
    ).toBe('fail')
  })

  it('is pending while any run is still going', () => {
    expect(
      summarizeChecks([
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', status: 'QUEUED' }
      ])
    ).toBe('pending')
  })

  it('understands StatusContext entries (state instead of status/conclusion)', () => {
    expect(summarizeChecks([{ __typename: 'StatusContext', state: 'SUCCESS' }])).toBe('pass')
    expect(summarizeChecks([{ __typename: 'StatusContext', state: 'PENDING' }])).toBe('pending')
    expect(summarizeChecks([{ __typename: 'StatusContext', state: 'ERROR' }])).toBe('fail')
  })
})

describe('parsePrView', () => {
  it('shapes a gh pr view payload', () => {
    const pr = parsePrView({
      number: 12,
      url: 'https://github.com/o/r/pull/12',
      state: 'OPEN',
      reviewDecision: 'APPROVED',
      statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }]
    })!
    expect(pr.number).toBe(12)
    expect(pr.state).toBe('OPEN')
    expect(pr.checks).toBe('pass')
    expect(pr.reviewDecision).toBe('APPROVED')
  })

  it('rejects malformed payloads', () => {
    expect(parsePrView(null)).toBeNull()
    expect(parsePrView({})).toBeNull()
    expect(parsePrView({ number: 'x', url: 'u' })).toBeNull()
  })
})

/** A fake process world: a `gh` on the login-shell PATH (with whatever the
 * profile exports), a repo at a given HEAD, and a PR answer — each spawn is
 * logged with its env so the tests can count them and check what was passed. */
function fakeWorld(
  opts: { head?: string; pr?: object | null; ghFound?: boolean; shellEnv?: string } = {}
) {
  const state = {
    head: opts.head ?? 'aaa111',
    pr: opts.pr === undefined ? { number: 7, url: 'https://github.com/o/r/pull/7' } : opts.pr,
    ghFound: opts.ghFound ?? true,
    shellEnv: opts.shellEnv ?? 'HOME=/Users/me\nPATH=/opt/homebrew/bin:/usr/bin\n',
    spawns: [] as { line: string; env?: NodeJS.ProcessEnv }[],
    clock: 1_000_000
  }
  const run: Runner = async (file, args, _cwd, env) => {
    const line = `${file} ${args.join(' ')}`
    state.spawns.push({ line, env })
    if (args[0] === '-lc' && args[1] === 'command -v gh && env') {
      if (!state.ghFound) throw new Error('not found')
      return `/opt/homebrew/bin/gh\n${state.shellEnv}`
    }
    if (file === 'git' && args[0] === 'rev-parse') return `${state.head}\n`
    if (file === '/opt/homebrew/bin/gh' && args[0] === 'pr' && args[1] === 'view') {
      if (!state.pr) throw new Error('no pull requests found')
      return JSON.stringify(state.pr)
    }
    throw new Error(`unexpected spawn: ${line}`)
  }
  const views = () => state.spawns.filter((s) => s.line.includes(' pr view '))
  const ghViews = (): number => views().length
  const shells = (): number => state.spawns.filter((s) => s.line.includes('-lc')).length
  return { state, deps: { run, now: () => state.clock }, views, ghViews, shells }
}

describe('parseGhResolve', () => {
  it('finds the gh path and only the GH_*/GITHUB_* variables, ignoring profile noise', () => {
    const r = parseGhResolve(
      [
        'Welcome back!', // a chatty profile
        '/opt/homebrew/bin/gh',
        'HOME=/Users/me',
        'GH_TOKEN=ghp_abc',
        'GITHUB_TOKEN=ghp_def',
        'GH_HOST=github.example.com',
        'MULTI=first line',
        'GH_NOT_A_VAR line of the multi-line value', // no `=` → not a variable
        'OTHER_GH_TOKEN=nope'
      ].join('\n')
    )!
    expect(r.path).toBe('/opt/homebrew/bin/gh')
    expect(r.env).toEqual({
      GH_TOKEN: 'ghp_abc',
      GITHUB_TOKEN: 'ghp_def',
      GH_HOST: 'github.example.com'
    })
  })

  it('is null when no gh path is in the output', () => {
    expect(parseGhResolve('')).toBeNull()
    expect(parseGhResolve('HOME=/x\nGH_TOKEN=abc\n')).toBeNull()
  })
})

describe('prStatus cache', () => {
  beforeEach(() => resetPrCache())

  it("runs each poll with the login shell's GH_*/GITHUB_* variables over our own env", async () => {
    const w = fakeWorld({ shellEnv: 'HOME=/Users/me\nGH_TOKEN=ghp_abc\nGH_HOST=ghe.corp\n' })
    await prStatus('/wt/a', w.deps)
    const env = w.views()[0].env!
    expect(env.GH_TOKEN).toBe('ghp_abc')
    expect(env.GH_HOST).toBe('ghe.corp')
    // Layered over, not replacing, the process env — PATH etc. survive.
    expect(env.PATH).toBe(process.env.PATH)
    // The HEAD check needs none of it.
    expect(w.state.spawns.find((s) => s.line.startsWith('git rev-parse'))!.env).toBeUndefined()
  })

  it('asks gh once per (path, HEAD) and answers repeat polls from the cache', async () => {
    const w = fakeWorld()
    expect((await prStatus('/wt/a', w.deps))?.number).toBe(7)
    expect((await prStatus('/wt/a', w.deps))?.number).toBe(7)
    expect((await prStatus('/wt/a', w.deps))?.number).toBe(7)
    expect(w.ghViews()).toBe(1)
    // Every poll still paid for the cheap HEAD check, nothing else.
    expect(w.state.spawns.filter((s) => s.line.startsWith('git rev-parse')).length).toBe(3)
  })

  it('resolves the gh path + env through the login shell exactly once, across worktrees', async () => {
    const w = fakeWorld()
    await prStatus('/wt/a', w.deps)
    await prStatus('/wt/b', w.deps)
    await prStatus('/wt/c', w.deps)
    expect(w.shells()).toBe(1)
    expect(w.ghViews()).toBe(3) // distinct paths are distinct cache keys
  })

  it('re-queries when HEAD moves', async () => {
    const w = fakeWorld()
    await prStatus('/wt/a', w.deps)
    w.state.head = 'bbb222'
    w.state.pr = { number: 8, url: 'https://github.com/o/r/pull/8' }
    expect((await prStatus('/wt/a', w.deps))?.number).toBe(8)
    expect(w.ghViews()).toBe(2)
  })

  it('re-queries once the entry is older than the TTL (2 min), so remote-only changes (checks) still land', async () => {
    expect(PR_CACHE_TTL_MS).toBe(2 * 60_000)
    const w = fakeWorld()
    await prStatus('/wt/a', w.deps)
    w.state.clock += PR_CACHE_TTL_MS - 1
    await prStatus('/wt/a', w.deps)
    expect(w.ghViews()).toBe(1)
    w.state.clock += 2
    await prStatus('/wt/a', w.deps)
    expect(w.ghViews()).toBe(2)
  })

  it('caches a "no PR" answer too, and resetPrCache(path) drops just that worktree', async () => {
    const w = fakeWorld({ pr: null })
    expect(await prStatus('/wt/a', w.deps)).toBeNull()
    expect(await prStatus('/wt/a', w.deps)).toBeNull()
    expect(w.ghViews()).toBe(1)
    await prStatus('/wt/b', w.deps)
    resetPrCache('/wt/a')
    w.state.pr = { number: 9, url: 'https://github.com/o/r/pull/9' }
    expect((await prStatus('/wt/a', w.deps))?.number).toBe(9)
    expect((await prStatus('/wt/b', w.deps))).toBeNull() // b's entry survived
    expect(w.ghViews()).toBe(3)
  })

  it('returns null without caching the lookup when gh is not on the PATH, and retries later', async () => {
    const w = fakeWorld({ ghFound: false })
    expect(await prStatus('/wt/a', w.deps)).toBeNull()
    w.state.ghFound = true
    w.state.head = 'ccc333' // a new HEAD invalidates the cached null
    expect((await prStatus('/wt/a', w.deps))?.number).toBe(7)
    expect(w.shells()).toBe(2)
  })
})
