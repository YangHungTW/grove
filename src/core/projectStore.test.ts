import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectStore } from './projectStore'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccm-ps-'))
  file = join(dir, 'projects.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('ProjectStore — recent projects (persisted)', () => {
  it('add returns an entry with name derived from the path basename', () => {
    const store = new ProjectStore(file)
    const e = store.add('/Users/x/my-repo')
    expect(e.repoRoot).toBe('/Users/x/my-repo')
    expect(e.name).toBe('my-repo')
  })

  it('list returns most-recently-added first', () => {
    const store = new ProjectStore(file)
    store.add('/a/alpha')
    store.add('/b/beta')
    expect(store.list().map((p) => p.name)).toEqual(['beta', 'alpha'])
  })

  it('re-adding an existing path dedupes and moves it to the front', () => {
    const store = new ProjectStore(file)
    store.add('/a/alpha')
    store.add('/b/beta')
    store.add('/a/alpha')
    const names = store.list().map((p) => p.name)
    expect(names).toEqual(['alpha', 'beta'])
    expect(names).toHaveLength(2)
  })

  it('remove drops the entry', () => {
    const store = new ProjectStore(file)
    store.add('/a/alpha')
    store.add('/b/beta')
    store.remove('/a/alpha')
    expect(store.list().map((p) => p.name)).toEqual(['beta'])
  })

  it('persists across instances (reads the same file)', () => {
    new ProjectStore(file).add('/a/alpha')
    const reloaded = new ProjectStore(file)
    expect(reloaded.list().map((p) => p.name)).toEqual(['alpha'])
  })

  it('returns an empty list when the file does not exist yet', () => {
    expect(new ProjectStore(join(dir, 'nope.json')).list()).toEqual([])
  })

  it('update merges per-project config (hooks) and persists it', () => {
    const store = new ProjectStore(file)
    store.add('/a/alpha')
    store.update('/a/alpha', { hookCreate: 'npm install', hookRemove: 'echo bye' })
    const reloaded = new ProjectStore(file).list().find((p) => p.repoRoot === '/a/alpha')
    expect(reloaded?.hookCreate).toBe('npm install')
    expect(reloaded?.hookRemove).toBe('echo bye')
    expect(reloaded?.name).toBe('alpha')
  })

  it('update is a no-op for an unknown project', () => {
    const store = new ProjectStore(file)
    store.add('/a/alpha')
    store.update('/zzz/none', { hookCreate: 'x' })
    expect(store.list()).toHaveLength(1)
  })
})
