import { describe, it, expect } from 'vitest'
import {
  tmuxSessionName,
  buildTmuxControlLaunch,
  buildTmuxKill,
  durableEnabled
} from './tmuxLaunch'

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

  it('gives two agents in the SAME worktree different names via the key', () => {
    const wt = '/Users/me/Tools/grove'
    expect(tmuxSessionName(wt, 'key-a')).not.toBe(tmuxSessionName(wt, 'key-b'))
  })

  it('is stable for the same (worktree, key) — the basis for reattach', () => {
    const wt = '/Users/me/Tools/grove'
    expect(tmuxSessionName(wt, 'abc')).toBe(tmuxSessionName(wt, 'abc'))
  })

  it('sanitizes the key too (no . : /)', () => {
    expect(tmuxSessionName('/x', 'a.b/c:d')).toBe('grove__x_a_b_c_d')
    expect(tmuxSessionName('/x', 'a.b/c:d')).not.toMatch(/[.:/]/)
  })
})

describe('buildTmuxControlLaunch', () => {
  it('runs tmux -CC create-or-attach through a login shell with the sized session', () => {
    const { command, args } = buildTmuxControlLaunch('/bin/zsh', 'grove_x', 120, 40, 'claude')
    expect(command).toBe('/bin/zsh')
    // Outer shell is a login shell (finds tmux on PATH)...
    expect(args[0]).toBe('-lc')
    expect(args[1]).toContain('tmux -CC new-session -A -s grove_x')
    expect(args[1]).toContain('-x 120 -y 40')
    // ...but the INNER shell that runs the agent is interactive (-ilc) so it
    // sources .zshrc and inherits the user's PATH + aliases.
    expect(args[1]).toContain("/bin/zsh -ilc 'claude'")
    expect(args[1].startsWith('exec ')).toBe(true)
  })

  it('single-quotes the agent command and escapes embedded quotes', () => {
    const { args } = buildTmuxControlLaunch('/bin/zsh', 'g', 80, 24, "claude --resume 'a b'")
    // The embedded single quotes become the '\'' escape sequence.
    expect(args[1]).toContain("-ilc 'claude --resume '\\''a b'\\'''")
  })
})

describe('buildTmuxKill', () => {
  it('kills each named session through a login shell', () => {
    const { command, args } = buildTmuxKill('/bin/zsh', ['grove_a', 'grove_b'])
    expect(command).toBe('/bin/zsh')
    expect(args[0]).toBe('-lc') // login shell — Electron from Finder has no tmux on PATH
    expect(args[1]).toContain('tmux kill-session -t "$s"')
    // Names ride as positional args ($0 is the `--` placeholder), never inlined.
    expect(args.slice(2)).toEqual(['--', 'grove_a', 'grove_b'])
  })

  it('tolerates an already-dead session instead of aborting the loop', () => {
    expect(buildTmuxKill('/bin/zsh', ['x']).args[1]).toContain('|| true')
  })

  it('never interpolates a name into the script (no shell injection)', () => {
    const { args } = buildTmuxKill('/bin/zsh', ['grove_x; rm -rf ~'])
    expect(args[1]).not.toContain('rm -rf')
    expect(args).toContain('grove_x; rm -rf ~')
  })
})
