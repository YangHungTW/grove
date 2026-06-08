import { describe, it, expect } from 'vitest'
import { detectState } from './stateDetection'

// Fixtures approximate Claude Code TUI output. Detection is heuristic on the
// tail of the terminal buffer; keep these representative of real frames.
const WAITING = [
  'Edited src/app.ts',
  '',
  'Do you want to proceed?',
  '❯ 1. Yes',
  '  2. No, tell Claude what to do differently'
].join('\n')

const BUSY = ['✻ Working… (esc to interrupt · 12s · ↑ 1.2k tokens)'].join('\n')

const IDLE = ['╭───────────────────────────╮', '│ > │', '╰───────────────────────────╯', '  ? for shortcuts'].join('\n')

describe('detectState — Claude Code', () => {
  it('returns "waiting" for an approval/input-prompt buffer', () => {
    expect(detectState(WAITING, 'claude')).toBe('waiting')
  })

  it('returns "busy" for an in-progress buffer', () => {
    expect(detectState(BUSY, 'claude')).toBe('busy')
  })

  it('returns "idle" for a returned-to-prompt buffer', () => {
    expect(detectState(IDLE, 'claude')).toBe('idle')
  })

  it('falls back to "idle" for an unknown agent', () => {
    expect(detectState(BUSY, 'totally-unknown-agent')).toBe('idle')
  })
})
