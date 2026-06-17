import { describe, it, expect } from 'vitest'
import { shiftEnterByte, type TermKeyEvent } from './termKeys'

const ev = (over: Partial<TermKeyEvent>): TermKeyEvent => ({
  key: 'Enter',
  type: 'keydown',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...over
})

describe('shiftEnterByte', () => {
  it('sends LF on Shift+Enter keydown', () => {
    expect(shiftEnterByte(ev({ shiftKey: true }))).toBe('\x0a')
  })
  it('swallows the matching keyup/keypress (empty string, no extra byte)', () => {
    expect(shiftEnterByte(ev({ shiftKey: true, type: 'keyup' }))).toBe('')
  })
  it('ignores plain Enter (xterm sends its own CR)', () => {
    expect(shiftEnterByte(ev({ shiftKey: false }))).toBeNull()
  })
  it('ignores Shift+Enter combined with other modifiers', () => {
    expect(shiftEnterByte(ev({ shiftKey: true, ctrlKey: true }))).toBeNull()
    expect(shiftEnterByte(ev({ shiftKey: true, metaKey: true }))).toBeNull()
    expect(shiftEnterByte(ev({ shiftKey: true, altKey: true }))).toBeNull()
  })
  it('ignores other keys', () => {
    expect(shiftEnterByte(ev({ key: 'a', shiftKey: true }))).toBeNull()
  })
})
