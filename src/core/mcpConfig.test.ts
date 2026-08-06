import { describe, it, expect } from 'vitest'
import { buildMcpConfig, mcpConfigFlag, negotiateProtocol } from './mcpConfig'

describe('buildMcpConfig', () => {
  const cfg = buildMcpConfig(51234, 'tkt')

  it('binds to loopback only', () => {
    // This endpoint can type into the user's terminals. It must not be
    // reachable off-box whatever the machine's firewall happens to allow.
    expect(cfg.mcpServers.grove.url).toBe('http://127.0.0.1:51234/mcp')
    expect(cfg.mcpServers.grove.url).not.toContain('0.0.0.0')
  })

  it('carries the ticket as a bearer token', () => {
    expect(cfg.mcpServers.grove.headers.Authorization).toBe('Bearer tkt')
    expect(cfg.mcpServers.grove.type).toBe('http')
  })

  it('names the server so its tools land under mcp__grove__*', () => {
    expect(Object.keys(cfg.mcpServers)).toEqual(['grove'])
  })
})

describe('mcpConfigFlag', () => {
  it('points at a file, never inlining the config', () => {
    // Inline JSON would put the bearer ticket on a command line, which `ps`
    // shows to every process on the machine.
    const flag = mcpConfigFlag('/u/mcp/a.json')
    expect(flag).toBe('--mcp-config /u/mcp/a.json')
    expect(flag).not.toContain('Bearer')
  })

  it('does not add --strict-mcp-config, which would drop the user own servers', () => {
    expect(mcpConfigFlag('/x.json')).not.toContain('strict')
  })
})

describe('negotiateProtocol', () => {
  it('echoes back a revision the client asked for', () => {
    expect(negotiateProtocol('2025-11-25')).toBe('2025-11-25')
    expect(negotiateProtocol('2024-11-05')).toBe('2024-11-05')
  })

  it('falls back to a known revision for anything unrecognised', () => {
    for (const bad of ['1999-01-01', '', 42, undefined, null])
      expect(negotiateProtocol(bad)).toBe('2025-06-18')
  })
})
