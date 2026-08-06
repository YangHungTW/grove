import { describe, it, expect } from 'vitest'
import { OutputBuffer } from './outputBuffer'

describe('OutputBuffer', () => {
  it('accumulates lines across chunk boundaries', () => {
    const b = new OutputBuffer()
    b.append('hello ')
    b.append('world\nsecond\n')
    expect(b.tail()).toEqual(['hello world', 'second'])
  })

  it('includes the line still being written', () => {
    // An agent mid-answer has not printed its newline yet; dropping it would
    // make tail() perpetually one step behind the pane.
    const b = new OutputBuffer()
    b.append('done\nthinking about')
    expect(b.tail()).toEqual(['done', 'thinking about'])
  })

  it('treats a bare CR as a repaint, not as content', () => {
    // Agents rewrite their cost/status row in place. Keeping the raw bytes
    // would splice a stale frame onto a fresh one ("…025$323.35").
    const b = new OutputBuffer()
    b.append('cost: $3,232,025\rcost: $323.35\n')
    expect(b.tail()).toEqual(['cost: $323.35'])
  })

  it('counts CRLF as a single line break', () => {
    const b = new OutputBuffer()
    b.append('a\r\nb\r\n')
    expect(b.tail()).toEqual(['a', 'b'])
  })

  it('strips escape sequences on the way in', () => {
    const b = new OutputBuffer()
    b.append('\x1b[31mred\x1b[0m\n')
    expect(b.tail()).toEqual(['red'])
  })

  it('drops the oldest lines instead of growing without bound', () => {
    const b = new OutputBuffer(3)
    for (const n of [1, 2, 3, 4, 5]) b.append(`line ${n}\n`)
    expect(b.tail()).toEqual(['line 3', 'line 4', 'line 5'])
  })

  it('returns only the requested number of lines, newest last', () => {
    const b = new OutputBuffer()
    for (const n of [1, 2, 3, 4, 5]) b.append(`line ${n}\n`)
    expect(b.tail(2)).toEqual(['line 4', 'line 5'])
  })

  it('skips blank lines so padding does not eat the window', () => {
    const b = new OutputBuffer()
    b.append('a\n\n\n   \nb\n')
    expect(b.tail()).toEqual(['a', 'b'])
  })
})
