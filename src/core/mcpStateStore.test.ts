import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpStateStore, pruneDurable, type McpState } from './mcpStateStore'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'grove-mcp-state-'))
  file = join(dir, 'nested', 'state.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('McpStateStore', () => {
  it('round-trips port and durable tickets', () => {
    const state: McpState = { port: 51234, durable: { 'key-a': 'ticket-a', 'key-b': 'ticket-b' } }
    new McpStateStore(file).save(state)
    expect(new McpStateStore(file).load()).toEqual(state)
  })

  it('starts empty when the file does not exist', () => {
    expect(new McpStateStore(file).load()).toEqual({ port: undefined, durable: {} })
  })

  it('survives a corrupt or wrong-shape file rather than throwing', () => {
    new McpStateStore(file).save({ durable: {} }) // creates the directory
    for (const bad of ['not json', '[]', '{"port":"x","durable":{"k":42}}']) {
      writeFileSync(file, bad)
      const s = new McpStateStore(file).load()
      expect(s.durable).toEqual({})
      expect(s.port).toBeUndefined()
    }
  })

  it('drops non-string and empty tickets on load', () => {
    new McpStateStore(file).save({ durable: {} })
    writeFileSync(file, JSON.stringify({ durable: { good: 'tkt', bad: 7, empty: '' } }))
    expect(new McpStateStore(file).load().durable).toEqual({ good: 'tkt' })
  })

  it('rejects a nonsensical persisted port', () => {
    new McpStateStore(file).save({ durable: {} })
    writeFileSync(file, JSON.stringify({ port: -1, durable: {} }))
    expect(new McpStateStore(file).load().port).toBeUndefined()
  })

  it('writes the file 0600 — tickets are type-into-terminal credentials', () => {
    new McpStateStore(file).save({ durable: { k: 't' } })
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})

describe('pruneDurable', () => {
  it('keeps only tickets some layout or closed-agent entry still references', () => {
    const state: McpState = { port: 1, durable: { live: 'a', orphan: 'b' } }
    expect(pruneDurable(state, new Set(['live']))).toEqual({ port: 1, durable: { live: 'a' } })
  })

  it('empties out when nothing references anything', () => {
    // An unreferenced ticket is a live credential with no owner.
    expect(pruneDurable({ durable: { x: 'a' } }, new Set()).durable).toEqual({})
  })
})
