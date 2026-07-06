import { describe, it, expect } from 'vitest'
import { hookFailedMessage } from './hookMessage'

describe('hookFailedMessage', () => {
  it('names the create hook and its non-zero exit code', () => {
    expect(hookFailedMessage({ kind: 'create', code: 1, output: '' })).toBe(
      'Create-worktree hook exited 1'
    )
  })

  it('names the remove hook', () => {
    expect(hookFailedMessage({ kind: 'remove', code: 3, output: '' })).toBe(
      'Remove-worktree hook exited 3'
    )
  })

  it('says "could not start" when the shell never spawned (code null)', () => {
    expect(hookFailedMessage({ kind: 'create', code: null, output: '' })).toBe(
      'Create-worktree hook could not start'
    )
  })

  it('appends only the LAST non-empty output line (skips interactive-shell noise)', () => {
    const output = 'p10k prompt junk\n\n  npm: command not found\n'
    expect(hookFailedMessage({ kind: 'create', code: 127, output })).toBe(
      'Create-worktree hook exited 127 — npm: command not found'
    )
  })

  it('omits the detail when output is empty or whitespace', () => {
    expect(hookFailedMessage({ kind: 'remove', code: 2, output: '   \n\n' })).toBe(
      'Remove-worktree hook exited 2'
    )
  })
})
