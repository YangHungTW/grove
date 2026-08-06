import { describe, it, expect } from 'vitest'
import {
  parseRegistryEntry,
  registryUpdates,
  toSessionState,
  unjoinedEntries,
  type JoinedState,
  type RegistryEntry
} from './claudeRegistry'

// A real record, copied from ~/.claude/sessions/<pid>.json while a probe session
// sat with a dialog open. The waiting/waitingFor pair is the whole reason this
// module exists — it is the state stateDetection.ts has to guess at.
const WAITING = {
  pid: 86188,
  sessionId: 'fe0453f9-c9dd-4c81-879f-420835f4fc12',
  cwd: '/tmp/probe',
  version: '2.1.222',
  peerProtocol: 1,
  kind: 'interactive',
  entrypoint: 'cli',
  name: 'probe-83',
  nameSource: 'derived',
  status: 'waiting',
  waitingFor: 'dialog open',
  startedAt: 1786007215085,
  updatedAt: 1786007226653
}

describe('parseRegistryEntry', () => {
  it('reads a live waiting record, reason included', () => {
    const e = parseRegistryEntry(WAITING)!
    expect(e.status).toBe('waiting')
    expect(e.waitingFor).toBe('dialog open')
    expect(e.sessionId).toBe('fe0453f9-c9dd-4c81-879f-420835f4fc12')
    expect(e.kind).toBe('interactive')
  })

  it('drops waitingFor unless the session is actually waiting', () => {
    // Claude clears the field itself, but a half-written file could carry a
    // stale reason — a lingering "dialog open" on an idle tab reads as a bug.
    const e = parseRegistryEntry({ ...WAITING, status: 'idle' })!
    expect(e.status).toBe('idle')
    expect(e.waitingFor).toBeUndefined()
  })

  it('normalizes the background spelling ("bg" on disk, "background" from --json)', () => {
    expect(parseRegistryEntry({ ...WAITING, kind: 'bg' })!.kind).toBe('bg')
    expect(parseRegistryEntry({ ...WAITING, kind: 'background' })!.kind).toBe('bg')
  })

  it('keeps jobId — the id `claude stop <id>` needs', () => {
    expect(parseRegistryEntry({ ...WAITING, kind: 'bg', jobId: 'a8e23050' })!.jobId).toBe('a8e23050')
  })

  it('returns null for records it cannot use rather than throwing', () => {
    // Another program writes this directory whenever it likes: a truncated or
    // newer-schema file is routine, not an error.
    expect(parseRegistryEntry(null)).toBeNull()
    expect(parseRegistryEntry('nonsense')).toBeNull()
    expect(parseRegistryEntry({})).toBeNull()
    expect(parseRegistryEntry({ ...WAITING, sessionId: undefined })).toBeNull()
    expect(parseRegistryEntry({ ...WAITING, pid: 'nope' })).toBeNull()
    expect(parseRegistryEntry({ ...WAITING, status: 'compacting' })).toBeNull()
  })
})

describe('toSessionState', () => {
  it('passes the three registry states straight through to Grove states', () => {
    for (const status of ['busy', 'idle', 'waiting'] as const)
      expect(toSessionState(parseRegistryEntry({ ...WAITING, status })!)).toBe(status)
  })
})

describe('registryUpdates', () => {
  const UUID = WAITING.sessionId
  const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
    ...parseRegistryEntry(WAITING)!,
    ...over
  })
  const joins = new Map([['s1', UUID]])
  const showing = (s: JoinedState): Map<string, JoinedState> => new Map([['s1', s]])

  it('reports a state change with its reason', () => {
    const out = registryUpdates([entry()], joins, showing({ state: 'busy' }))
    expect(out).toEqual([
      { groveId: 's1', state: 'waiting', waitingFor: 'dialog open', reasonOnly: false }
    ])
  })

  it('stays quiet when nothing moved', () => {
    const now = showing({ state: 'waiting', waitingFor: 'dialog open' })
    expect(registryUpdates([entry()], joins, now)).toEqual([])
  })

  it('flags a reason-only change — one dialog replaced by another', () => {
    // The state setter early-returns on an unchanged state, so this case has to
    // be distinguishable or the new reason would never reach the UI.
    const now = showing({ state: 'waiting', waitingFor: 'sandbox request' })
    const out = registryUpdates([entry()], joins, now)
    expect(out).toEqual([
      { groveId: 's1', state: 'waiting', waitingFor: 'dialog open', reasonOnly: true }
    ])
  })

  it('clears the reason when the session goes back to work', () => {
    const now = showing({ state: 'waiting', waitingFor: 'dialog open' })
    const out = registryUpdates([entry({ status: 'busy', waitingFor: undefined })], joins, now)
    expect(out).toEqual([{ groveId: 's1', state: 'busy', waitingFor: undefined, reasonOnly: false }])
  })

  it('leaves a session alone when no live record backs it', () => {
    // The resume chain can fall through to a bare `claude` with a uuid Grove
    // never learned. That session must keep falling back to stateDetection
    // rather than freezing on its last registry-supplied state.
    expect(registryUpdates([], joins, showing({ state: 'busy' }))).toEqual([])
    const stranger = entry({ sessionId: 'someone-else' })
    expect(registryUpdates([stranger], joins, showing({ state: 'busy' }))).toEqual([])
  })

  it('never resurrects a tab the pty already marked exited', () => {
    expect(registryUpdates([entry()], joins, showing({ state: 'exited' }))).toEqual([])
  })

  it('ignores joins whose Grove session is gone', () => {
    expect(registryUpdates([entry()], joins, new Map())).toEqual([])
  })
})

describe('unjoinedEntries', () => {
  const mine = parseRegistryEntry(WAITING)!
  const elsewhere = parseRegistryEntry({ ...WAITING, pid: 1, sessionId: 'other', name: 'sdes-87' })!

  it('keeps only sessions that are not one of Grove own panes', () => {
    const out = unjoinedEntries([mine, elsewhere], new Set([mine.sessionId]))
    expect(out.map((e) => e.sessionId)).toEqual(['other'])
  })

  it('returns everything when Grove has no agents open', () => {
    expect(unjoinedEntries([mine, elsewhere], new Set())).toHaveLength(2)
  })
})
