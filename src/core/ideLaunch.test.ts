import { describe, it, expect } from 'vitest'
import {
  canOpenInIde,
  isTerminalEditor,
  buildIdeOpenAction,
  IDE_SHELL_ICON
} from './ideLaunch'

const ctx = { worktreeId: 'wt1', cwd: '/repo', cols: 100 }

describe('canOpenInIde', () => {
  it('is false when ide is unset or the command is empty/whitespace', () => {
    expect(canOpenInIde({})).toBe(false)
    expect(canOpenInIde({ ide: { command: '', terminal: false } })).toBe(false)
    expect(canOpenInIde({ ide: { command: '   ', terminal: false } })).toBe(false)
  })
  it('is true when a command is configured', () => {
    expect(canOpenInIde({ ide: { command: 'code', terminal: false } })).toBe(true)
    expect(canOpenInIde({ ide: { command: 'vim', terminal: true } })).toBe(true)
  })
})

describe('isTerminalEditor', () => {
  it('honours the explicit flag', () => {
    expect(isTerminalEditor({ command: 'code', terminal: true })).toBe(true)
  })
  it('infers known TUI binaries even without the flag', () => {
    expect(isTerminalEditor({ command: 'nvim', terminal: false })).toBe(true)
    expect(isTerminalEditor({ command: '/usr/bin/vim', terminal: false })).toBe(true)
    expect(isTerminalEditor({ command: 'code -g', terminal: false })).toBe(false)
  })
})

describe('buildIdeOpenAction', () => {
  it('routes a terminal editor (vim) into a shell session running the editor', () => {
    const action = buildIdeOpenAction({ command: 'vim', terminal: true }, '/repo/src/foo.ts', ctx)
    expect(action.mode).toBe('session')
    if (action.mode !== 'session') throw new Error('expected session')
    expect(action.request.kind).toBe('shell')
    expect(action.request.worktreeId).toBe('wt1')
    expect(action.request.icon).toBe(IDE_SHELL_ICON)
    expect(action.request.bootstrap).toContain('vim')
    expect(action.request.bootstrap).toContain('/repo/src/foo.ts')
  })

  it('routes a GUI editor (code) into an exec action with no session', () => {
    const action = buildIdeOpenAction({ command: 'code', terminal: false }, '/repo/src/foo.ts', ctx)
    expect(action.mode).toBe('exec')
    if (action.mode !== 'exec') throw new Error('expected exec')
    expect(action.command).toBe('code')
    expect(action.filePath).toBe('/repo/src/foo.ts')
  })
})
