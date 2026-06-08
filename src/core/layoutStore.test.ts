import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LayoutStore, type SessionDescriptor } from './layoutStore'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccm-ls-'))
  file = join(dir, 'layout.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const sample: SessionDescriptor[] = [
  { repoRoot: '/a', worktreePath: '/a', kind: 'agent', title: 'claude' },
  { repoRoot: '/a', worktreePath: '/a', kind: 'shell', title: 'shell' }
]

describe('LayoutStore — session layout (persisted)', () => {
  it('load returns [] when the file does not exist', () => {
    expect(new LayoutStore(file).load()).toEqual([])
  })

  it('save then load round-trips the descriptors', () => {
    const store = new LayoutStore(file)
    store.save(sample)
    expect(store.load()).toEqual(sample)
  })

  it('persists across instances', () => {
    new LayoutStore(file).save(sample)
    expect(new LayoutStore(file).load()).toEqual(sample)
  })

  it('save overwrites previous contents', () => {
    const store = new LayoutStore(file)
    store.save(sample)
    store.save([{ repoRoot: '/b', worktreePath: '/b', kind: 'shell', title: 'shell' }])
    expect(store.load()).toHaveLength(1)
    expect(store.load()[0].repoRoot).toBe('/b')
  })
})
