import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, DEFAULT_SETTINGS } from './settingsStore'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccm-set-'))
  file = join(dir, 'settings.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SettingsStore', () => {
  it('load returns defaults when the file does not exist', () => {
    expect(new SettingsStore(file).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('durableSessions defaults off and round-trips when enabled', () => {
    expect(DEFAULT_SETTINGS.durableSessions).toBe(false)
    expect(new SettingsStore(file).load().durableSessions).toBe(false)
    new SettingsStore(file).save({ durableSessions: true })
    expect(new SettingsStore(file).load().durableSessions).toBe(true)
  })

  it('per-agent default skills round-trip through disk', () => {
    const agents = [{ id: 'claude', name: 'Claude', command: 'claude', icon: '✳', skills: ['x'] }]
    new SettingsStore(file).save({ agents })
    expect(new SettingsStore(file).load().agents[0].skills).toEqual(['x'])
  })

  it('an agent persisted before skills existed loads with skills undefined', () => {
    // The field is optional precisely so settingsStore needs no migration —
    // every settings.json written by an earlier Grove must still load.
    writeFileSync(
      file,
      JSON.stringify({ agents: [{ id: 'claude', name: 'Claude', command: 'claude', icon: '✳' }] })
    )
    const loaded = new SettingsStore(file).load()
    expect(loaded.agents[0].skills).toBeUndefined()
    expect(loaded.agents[0].command).toBe('claude')
  })

  it('collapsedProjects defaults to empty and round-trips', () => {
    expect(DEFAULT_SETTINGS.collapsedProjects).toEqual([])
    expect(new SettingsStore(file).load().collapsedProjects).toEqual([])
    new SettingsStore(file).save({ collapsedProjects: ['/a', '/b'] })
    expect(new SettingsStore(file).load().collapsedProjects).toEqual(['/a', '/b'])
  })

  it('a settings file written before collapsedProjects existed gains the default', () => {
    // load() spreads DEFAULT_SETTINGS under the parsed file, so no migration
    // code is needed for pre-feature settings.json files.
    writeFileSync(file, JSON.stringify({ opacity: 0.9 }))
    const loaded = new SettingsStore(file).load()
    expect(loaded.collapsedProjects).toEqual([])
    expect(loaded.opacity).toBe(0.9)
  })

  it('save merges a partial patch and persists', () => {
    const store = new SettingsStore(file)
    const next = store.save({ background: '#101014', transparent: true })
    expect(next.background).toBe('#101014')
    expect(next.transparent).toBe(true)
    // untouched fields keep defaults
    expect(next.opacity).toBe(DEFAULT_SETTINGS.opacity)
  })

  it('persists across instances and fills missing keys with defaults', () => {
    new SettingsStore(file).save({ opacity: 0.8 })
    const reloaded = new SettingsStore(file).load()
    expect(reloaded.opacity).toBe(0.8)
    expect(reloaded.background).toBe(DEFAULT_SETTINGS.background)
  })

  it('ignores a corrupt file and returns defaults', () => {
    new SettingsStore(file).save({ opacity: 0.5 })
    rmSync(file)
    expect(new SettingsStore(file).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('migrates the legacy single-Claude agent list up to the current presets', () => {
    writeFileSync(file, JSON.stringify({ agents: [{ id: 'claude', name: 'Claude', command: 'claude', icon: '★' }] }))
    expect(new SettingsStore(file).load().agents).toEqual(DEFAULT_SETTINGS.agents)
  })

  it('keeps a user-customised agent list as-is (no migration)', () => {
    const custom = [{ id: 'x', name: 'My', command: 'agy', icon: '✦' }]
    writeFileSync(file, JSON.stringify({ agents: custom }))
    expect(new SettingsStore(file).load().agents).toEqual(custom)
  })
})
