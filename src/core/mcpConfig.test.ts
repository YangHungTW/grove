import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { buildMcpConfig, mcpConfigFlag, negotiateProtocol } from './mcpConfig'
import { buildTmuxControlLaunch } from './tmuxLaunch'

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
    expect(flag).toBe("--mcp-config '/u/mcp/a.json'")
    expect(flag).not.toContain('Bearer')
  })

  it('does not add --strict-mcp-config, which would drop the user own servers', () => {
    expect(mcpConfigFlag('/x.json')).not.toContain('strict')
  })

  // The real config lives under Electron's userData, which on macOS is
  // ~/Library/Application Support/Grove — a path WITH A SPACE. Unquoted, the
  // `$SHELL -ilc` launch split it in two, and since --mcp-config is variadic it
  // swallowed both halves and reported each as a missing config file. Every
  // agent Grove launched on a Mac hit this.
  const SPACED = '/Users/me/Library/Application Support/Grove/mcp/a.json'

  it('survives a path with spaces as ONE argument', () => {
    const argv = execFileSync(
      '/bin/sh',
      ['-c', `printf '%s\\n' claude ${mcpConfigFlag(SPACED)} --session-id UUID`],
      { encoding: 'utf8' }
    )
      .trimEnd()
      .split('\n')
    expect(argv).toEqual(['claude', '--mcp-config', SPACED, '--session-id', 'UUID'])
  })

  it('survives the extra quoting layer a durable (tmux) launch adds', () => {
    // A durable agent's command is single-quoted AGAIN inside
    // `tmux new-session … $SHELL -ilc '<cmd>'`, so the flag round-trips through
    // two levels of quoting. printf stands in for the agent binary.
    const agentCmd = `printf '%s\\n' ${mcpConfigFlag(SPACED)} --session-id UUID`
    const { args } = buildTmuxControlLaunch('/bin/sh', 'grove_x', 80, 24, agentCmd)
    // Run exactly the payload tmux would run (-c rather than -ilc: an
    // interactive login shell would drown the output in prompt noise).
    const payload = args[1].slice(args[1].indexOf('/bin/sh -ilc ')).replace('-ilc', '-c')
    const argv = execFileSync('/bin/sh', ['-c', payload], { encoding: 'utf8' })
      .trimEnd()
      .split('\n')
    expect(argv).toEqual(['--mcp-config', SPACED, '--session-id', 'UUID'])
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
