import { describe, it, expect } from 'vitest'
import { classifyExit } from './sessionExit'

describe('classifyExit', () => {
  it('treats a zero exit code as clean (auto-close)', () => {
    expect(classifyExit(0)).toEqual({ failed: false, reason: 'exit code 0' })
  })

  it('treats a missing exit code with no signal as clean', () => {
    expect(classifyExit()).toEqual({ failed: false, reason: 'exit code 0' })
    expect(classifyExit(null, null)).toEqual({ failed: false, reason: 'exit code 0' })
  })

  it('flags a non-zero exit code as failed (e.g. command not found = 127)', () => {
    expect(classifyExit(127)).toEqual({ failed: true, reason: 'exit code 127' })
    expect(classifyExit(1)).toEqual({ failed: true, reason: 'exit code 1' })
  })

  it('flags a signalled exit as failed, even with exit code 0', () => {
    expect(classifyExit(0, 9)).toEqual({ failed: true, reason: 'killed by signal 9' })
    expect(classifyExit(null, 15)).toEqual({ failed: true, reason: 'killed by signal 15' })
  })
})
