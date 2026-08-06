import { describe, it, expect } from 'vitest'
import { stripAnsi } from './ansi'

describe('stripAnsi', () => {
  it('removes CSI colour/cursor sequences with their ESC byte', () => {
    // The bug this replaced: matching the sequence body but leaving 0x1b behind.
    const out = stripAnsi('\x1b[31mred\x1b[0m \x1b[2K\x1b[1;5Hmoved')
    expect(out).toBe('red moved')
    expect(out).not.toContain('\x1b')
  })

  it('removes an OSC title sequence terminated by BEL or ST', () => {
    expect(stripAnsi('\x1b]0;a title\x07text')).toBe('text')
    expect(stripAnsi('\x1b]0;a title\x1b\\text')).toBe('text')
  })

  it('removes two-character and charset escapes', () => {
    expect(stripAnsi('\x1bMup')).toBe('up')
    expect(stripAnsi('\x1b(Bplain')).toBe('plain')
  })

  it('leaves ordinary text — including CR — untouched', () => {
    // Callers rely on CR surviving: it is how an in-place repaint is detected.
    expect(stripAnsi('$3,232,025\r$323.35')).toBe('$3,232,025\r$323.35')
  })
})
