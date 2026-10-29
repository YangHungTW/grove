// The spawn plumbing under every worktree.ts call: the concurrency cap on git
// processes and the in-flight dedup used by the status IPC handler. No real
// git here — the spawn is swapped for a fake that resolves on demand.
import { describe, it, expect, afterEach } from 'vitest'
import {
  limitConcurrency,
  dedupeInFlight,
  setGitExecForTests,
  branchExists,
  GIT_MAX_CONCURRENT
} from './worktree'

/** A task that reports how many siblings are running and finishes on demand. */
function gate(): {
  start: (id: number) => Promise<string>
  running: () => number
  peak: () => number
  finishAll: () => void
  started: () => number[]
} {
  let running = 0
  let peak = 0
  const started: number[] = []
  const pending: Array<() => void> = []
  return {
    start: (id) => {
      running++
      peak = Math.max(peak, running)
      started.push(id)
      return new Promise<string>((resolve) => {
        pending.push(() => {
          running--
          resolve(`done-${id}`)
        })
      })
    },
    running: () => running,
    peak: () => peak,
    finishAll: () => {
      for (const f of pending.splice(0)) f()
    },
    started: () => started
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('limitConcurrency', () => {
  it('never runs more than `max` tasks at once and starts queued ones FIFO', async () => {
    const limit = limitConcurrency(2)
    const g = gate()
    const all = Promise.all([1, 2, 3, 4, 5].map((id) => limit(() => g.start(id))))
    await tick()
    expect(g.running()).toBe(2)
    expect(g.started()).toEqual([1, 2])
    g.finishAll()
    await tick()
    expect(g.started()).toEqual([1, 2, 3, 4])
    g.finishAll()
    await tick()
    g.finishAll()
    expect(await all).toEqual(['done-1', 'done-2', 'done-3', 'done-4', 'done-5'])
    expect(g.peak()).toBe(2)
  })

  it('releases the slot when a task rejects, so the queue keeps draining', async () => {
    const limit = limitConcurrency(1)
    const g = gate()
    const failing = limit(() => Promise.reject(new Error('boom')))
    const next = limit(() => g.start(1))
    await expect(failing).rejects.toThrow('boom')
    await tick()
    expect(g.running()).toBe(1)
    g.finishAll()
    expect(await next).toBe('done-1')
  })
})

describe('git() goes through the process cap', () => {
  afterEach(() => setGitExecForTests())

  it(`holds concurrent git calls to ${GIT_MAX_CONCURRENT} and still answers every caller`, async () => {
    const g = gate()
    let n = 0
    setGitExecForTests(() => g.start(++n))
    // 20 independent callers in one instant — the shape of a status tick.
    const all = Promise.all(Array.from({ length: 20 }, () => branchExists('/repo', 'main')))
    await tick()
    expect(g.running()).toBe(GIT_MAX_CONCURRENT)
    // Drain in rounds; nothing may ever exceed the cap.
    while (g.running() > 0) {
      g.finishAll()
      await tick()
    }
    expect(g.peak()).toBe(GIT_MAX_CONCURRENT)
    expect(await all).toEqual(Array(20).fill(true))
  })
})

describe('dedupeInFlight', () => {
  it('shares one pending call per key and forgets it once settled', async () => {
    const calls: string[] = []
    const resolvers = new Map<string, (v: string) => void>()
    const deduped = dedupeInFlight<string>((key) => {
      calls.push(key)
      return new Promise((resolve) => resolvers.set(key, resolve))
    })
    const a1 = deduped('a')
    const a2 = deduped('a')
    const b = deduped('b')
    expect(a1).toBe(a2) // the very same promise, not just the same value
    expect(calls).toEqual(['a', 'b'])
    resolvers.get('a')!('A')
    resolvers.get('b')!('B')
    expect(await Promise.all([a1, a2, b])).toEqual(['A', 'A', 'B'])
    // Settled → the next call for that key runs fresh.
    const a3 = deduped('a')
    expect(calls).toEqual(['a', 'b', 'a'])
    resolvers.get('a')!('A2')
    expect(await a3).toBe('A2')
  })

  it('forgets a rejected call too, so a transient failure is not sticky', async () => {
    let n = 0
    const deduped = dedupeInFlight<number>(() =>
      ++n === 1 ? Promise.reject(new Error('first')) : Promise.resolve(n)
    )
    await expect(deduped('k')).rejects.toThrow('first')
    expect(await deduped('k')).toBe(2)
  })
})
