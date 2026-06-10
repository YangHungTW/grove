import { describe, it, expect } from 'vitest'
import { supportsResume, buildAgentLaunch } from './resume'

const ID = () => 'fixed-uuid-0000'

describe('supportsResume', () => {
  it('is true for the claude CLI (with or without extra flags)', () => {
    expect(supportsResume('claude')).toBe(true)
    expect(supportsResume('claude --model opus')).toBe(true)
    expect(supportsResume('  claude  ')).toBe(true)
  })

  it('is false for other agents and shells', () => {
    expect(supportsResume('codex')).toBe(false)
    expect(supportsResume('gemini')).toBe(false)
    expect(supportsResume('shell')).toBe(false)
    expect(supportsResume('')).toBe(false)
  })
})

describe('buildAgentLaunch', () => {
  it('pins a new session id for a fresh claude session', () => {
    expect(buildAgentLaunch('claude', ID)).toEqual({
      command: 'claude --session-id fixed-uuid-0000',
      resumeId: 'fixed-uuid-0000'
    })
  })

  it('keeps existing flags when pinning the session id', () => {
    expect(buildAgentLaunch('claude --model opus', ID)).toEqual({
      command: 'claude --model opus --session-id fixed-uuid-0000',
      resumeId: 'fixed-uuid-0000'
    })
  })

  it('resumes an existing session id without minting a new one', () => {
    const newId = (): string => {
      throw new Error('newId must not be called on resume')
    }
    expect(buildAgentLaunch('claude', newId, 'abc-123')).toEqual({
      command: 'claude --resume abc-123',
      resumeId: 'abc-123'
    })
  })

  it('leaves non-resumable agents untouched (no id tracked)', () => {
    expect(buildAgentLaunch('codex', ID)).toEqual({ command: 'codex' })
    expect(buildAgentLaunch('codex', ID, 'abc-123')).toEqual({ command: 'codex' })
  })
})
