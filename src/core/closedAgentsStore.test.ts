import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClosedAgentsStore, type ClosedAgent } from './closedAgentsStore'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccm-ca-'))
  file = join(dir, 'closed-agents.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const sample: ClosedAgent[] = [
  {
    repoRoot: '/a',
    worktreePath: '/a',
    resumeId: '550e8400-e29b-41d4-a716-446655440000',
    baseCommand: 'claude',
    title: 'claude',
    icon: '★',
    closedAt: 1000
  },
  {
    repoRoot: '/a',
    worktreePath: '/a/wt',
    resumeId: '550e8400-e29b-41d4-a716-446655440001',
    baseCommand: 'claude',
    title: 'claude 2',
    closedAt: 2000
  }
]

describe('ClosedAgentsStore — recently-closed resumable agents (persisted)', () => {
  it('load returns [] when the file does not exist', () => {
    expect(new ClosedAgentsStore(file).load()).toEqual([])
  })

  it('save then load round-trips the entries', () => {
    const store = new ClosedAgentsStore(file)
    store.save(sample)
    expect(store.load()).toEqual(sample)
  })

  it('persists across instances', () => {
    new ClosedAgentsStore(file).save(sample)
    expect(new ClosedAgentsStore(file).load()).toEqual(sample)
  })

  it('save overwrites previous contents', () => {
    const store = new ClosedAgentsStore(file)
    store.save(sample)
    store.save([sample[1]])
    expect(store.load()).toEqual([sample[1]])
  })

  it('drops entries missing required fields', () => {
    writeFileSync(
      file,
      JSON.stringify([
        sample[0],
        { repoRoot: '/a', worktreePath: '/a' }, // no resumeId/baseCommand/title/closedAt
        { resumeId: 'x', baseCommand: 'claude', title: 't', closedAt: 5 } // no paths
      ])
    )
    expect(new ClosedAgentsStore(file).load()).toEqual([sample[0]])
  })

  it('returns [] for non-array / malformed JSON', () => {
    writeFileSync(file, '{"not":"an array"}')
    expect(new ClosedAgentsStore(file).load()).toEqual([])
    writeFileSync(file, 'not json at all')
    expect(new ClosedAgentsStore(file).load()).toEqual([])
  })

  it('caps load and save at 50 entries (most-recent-first input)', () => {
    const many: ClosedAgent[] = Array.from({ length: 70 }, (_, i) => ({
      repoRoot: '/a',
      worktreePath: '/a',
      resumeId: `id-${i}`,
      baseCommand: 'claude',
      title: `c${i}`,
      closedAt: i
    }))
    const store = new ClosedAgentsStore(file)
    store.save(many)
    const loaded = store.load()
    expect(loaded).toHaveLength(50)
    expect(loaded[0].resumeId).toBe('id-0')
    expect(loaded[49].resumeId).toBe('id-49')
  })
})
