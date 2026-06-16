import { describe, it, expect } from 'vitest'
import { tmuxSessionName, buildTmuxControlLaunch, durableEnabled } from './tmuxLaunch'

describe('durableEnabled', () => {
  it('is on only when opted in AND tmux is available', () => {
    expect(durableEnabled(true, true)).toBe(true)
  })
  it('falls back (off) when tmux is unavailable even if opted in', () => {
    expect(durableEnabled(true, false)).toBe(false)
  })
  it('is off when not opted in', () => {
    expect(durableEnabled(false, true)).toBe(false)
  })
})

describe('tmuxSessionName', () => {
  it('is deterministic and tmux-safe (no . : /)', () => {
    const a = tmuxSessionName('/Users/me/Tools/grove-wt-test')
    const b = tmuxSessionName('/Users/me/Tools/grove-wt-test')
    expect(a).toBe(b)
    expect(a.startsWith('grove_')).toBe(true)
    expect(a).not.toMatch(/[.:/]/)
  })

  it('collapses every non-alphanumeric char to _', () => {
    expect(tmuxSessionName('a.b:c/d e')).toBe('grove_a_b_c_d_e')
  })

  it('gives different worktrees different names', () => {
    expect(tmuxSessionName('/x/one')).not.toBe(tmuxSessionName('/x/two'))
  })
})

describe('buildTmuxControlLaunch', () => {
  it('runs tmux -CC create-or-attach through a login shell with the sized session', () => {
    const { command, args } = buildTmuxControlLaunch('/bin/zsh', 'grove_x', 120, 40, 'claude')
    expect(command).toBe('/bin/zsh')
    expect(args[0]).toBe('-lc')
    expect(args[1]).toContain('tmux -CC new-session -A -s grove_x')
    expect(args[1]).toContain('-x 120 -y 40')
    expect(args[1]).toContain("/bin/zsh -lc 'claude'")
    expect(args[1].startsWith('exec ')).toBe(true)
  })

  it('single-quotes the agent command and escapes embedded quotes', () => {
    const { args } = buildTmuxControlLaunch('/bin/zsh', 'g', 80, 24, "claude --resume 'a b'")
    // The embedded single quotes become the '\'' escape sequence.
    expect(args[1]).toContain("-lc 'claude --resume '\\''a b'\\'''")
  })
})
