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

  it('resumes an existing session id without minting a new one (with graceful fallback)', () => {
    const newId = (): string => {
      throw new Error('newId must not be called on resume')
    }
    expect(buildAgentLaunch('claude', newId, 'abc-123')).toEqual({
      // resume → else fresh-with-same-id → else plain, so the tab never vanishes
      command: 'claude --resume abc-123 || claude --session-id abc-123 || claude',
      resumeId: 'abc-123'
    })
  })

  it('leaves non-resumable agents untouched (no id tracked)', () => {
    expect(buildAgentLaunch('codex', ID)).toEqual({ command: 'codex' })
    expect(buildAgentLaunch('codex', ID, 'abc-123')).toEqual({ command: 'codex' })
  })

  describe('extraFlags (Grove --mcp-config injection)', () => {
    const FLAG = '--mcp-config /tmp/grove.json'

    it('reaches EVERY alternative, not just the last one', () => {
      // A `cmd --flag || cmd || cmd` chain that only flagged the tail would give
      // the Grove tools to a session only when resuming failed twice.
      const { command } = buildAgentLaunch('claude', ID, 'abc-123', FLAG)
      expect(command.split(' || ')).toEqual([
        `claude ${FLAG} --resume abc-123`,
        `claude ${FLAG} --session-id abc-123`,
        `claude ${FLAG}`
      ])
    })

    it('applies to a fresh session too', () => {
      expect(buildAgentLaunch('claude', ID, undefined, FLAG).command).toBe(
        `claude ${FLAG} --session-id fixed-uuid-0000`
      )
    })

    it('goes before the initial prompt, which is appended after this', () => {
      // withInitialPrompt() single-quotes the prompt onto the end. The flag has
      // to already be in place, or it would land after a positional argument.
      const { command } = buildAgentLaunch('claude', ID, undefined, FLAG)
      expect(command.endsWith('--session-id fixed-uuid-0000')).toBe(true)
    })

    it('is omitted entirely when there is nothing to inject', () => {
      expect(buildAgentLaunch('claude', ID).command).toBe('claude --session-id fixed-uuid-0000')
    })

    it('is never handed to a CLI that would not understand it', () => {
      // --mcp-config is claude-specific. Passing it to codex would at best be
      // ignored and at worst abort the launch.
      expect(buildAgentLaunch('codex', ID, undefined, FLAG)).toEqual({ command: 'codex' })
    })

    it('is always terminated by another flag, never left to eat a positional', () => {
      // --mcp-config is VARIADIC: it consumes arguments until the next
      // `-`-prefixed one. A task prompt is appended after this, so any branch
      // that can carry one must not end with the config path.
      for (const resume of [undefined, 'abc-123']) {
        for (const branch of buildAgentLaunch('claude', ID, resume, FLAG).command.split(' || ')) {
          const after = branch.slice(branch.indexOf(FLAG) + FLAG.length).trim()
          // The bare last-resort branch has nothing after it, and is only ever
          // reached on a resume chain — which never carries a prompt.
          if (after) expect(after.startsWith('--')).toBe(true)
        }
      }
    })
  })
})
