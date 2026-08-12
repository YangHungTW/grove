import { describe, it, expect } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { bufferLastLine, bufferTail, lastNonEmptyLine } from './lastLine'

const ESC = '\x1b'

describe('lastNonEmptyLine (raw-stream fallback)', () => {
  it('returns the last non-empty visible line', () => {
    expect(lastNonEmptyLine('one\ntwo\nthree\n')).toBe('three')
  })

  it('ignores trailing blank lines', () => {
    expect(lastNonEmptyLine('cost: $1.23\n\n   \n')).toBe('cost: $1.23')
  })

  it('strips CSI colour sequences (incl. the ESC byte)', () => {
    expect(lastNonEmptyLine(`${ESC}[38;5;5m$1.23${ESC}[0m\n`)).toBe('$1.23')
  })

  it('strips OSC (title / hyperlink) sequences', () => {
    // OSC 0 set-title, BEL-terminated, then the real line.
    expect(lastNonEmptyLine(`${ESC}]0;a title${'\x07'}status $1.23\n`)).toBe('status $1.23')
  })

  it('treats a bare CR as a row reset so an in-place repaint does not concatenate', () => {
    // The regression: "$3,232,025" repainted in place with "$323.35". Splitting
    // only on \n would yield the two mashed together ("...025$323.35"); the last
    // paint must win.
    expect(lastNonEmptyLine('$3,232,025\r$323.35')).toBe('$323.35')
  })

  it('handles CRLF without producing empty segments', () => {
    expect(lastNonEmptyLine('a\r\nb\r\n')).toBe('b')
  })

  it('returns null when there is no printable content', () => {
    expect(lastNonEmptyLine(`${ESC}[2K\r`)).toBeNull()
    expect(lastNonEmptyLine('')).toBeNull()
  })
})

/** Minimal fake of xterm's IBuffer for bufferLastLine: a list of already-rendered
 * rows (viewport = last `rows` entries; earlier entries are scrollback). */
function fakeTerm(rows: string[], visibleRows = rows.length): Terminal {
  const baseY = rows.length - visibleRows
  return {
    rows: visibleRows,
    buffer: {
      active: {
        baseY,
        getLine: (y: number) => {
          const text = rows[y]
          return text === undefined
            ? undefined
            : { translateToString: (_trimRight?: boolean) => text.replace(/\s+$/, '') }
        }
      }
    }
  } as unknown as Terminal
}

describe('bufferLastLine (xterm-resolved screen)', () => {
  it('reads the last non-empty visible row — already resolved, so no garble', () => {
    // xterm has applied the in-place repaint; the row simply reads correctly.
    expect(bufferLastLine(fakeTerm(['welcome', 'status $323.35', '']))).toBe('status $323.35')
  })

  it('skips trailing blank rows and trims padding', () => {
    expect(bufferLastLine(fakeTerm(['a', 'b   ', '   ', '']))).toBe('b')
  })

  it('does not read into scrollback below the viewport', () => {
    // 'scrollback line' is above baseY; only the 2 visible rows are considered.
    expect(bufferLastLine(fakeTerm(['scrollback line', '', ''], 2))).toBeNull()
  })

  it('returns null when the visible screen is empty', () => {
    expect(bufferLastLine(fakeTerm(['', '', '']))).toBeNull()
  })
})

describe('bufferTail (MCP tail source)', () => {
  it('returns the last n non-empty rows, oldest first', () => {
    expect(bufferTail(fakeTerm(['one', 'two', 'three', 'four']), 2)).toEqual(['three', 'four'])
  })

  it('skips blank rows so padding does not eat the window', () => {
    // A TUI leaves blank rows between its panels — they carry no information,
    // and counting them would let ten blanks push the real content out.
    expect(bufferTail(fakeTerm(['a', '', '  ', 'b', '']), 2)).toEqual(['a', 'b'])
  })

  it('reaches back INTO scrollback, unlike bufferLastLine', () => {
    // 'older' is above baseY (scrollback); tail wants history, not just the
    // visible screen.
    expect(bufferTail(fakeTerm(['older', 'newer', ''], 2), 5)).toEqual(['older', 'newer'])
  })

  it('returns fewer rows when the buffer has fewer', () => {
    expect(bufferTail(fakeTerm(['only']), 50)).toEqual(['only'])
  })

  it('caps how far back it scans so a huge scrollback cannot stall', () => {
    const rows = ['needle', ...Array.from({ length: 50 }, () => '')]
    // maxScan smaller than the blank run: the needle is out of reach — by
    // design, the scan must be bounded even when nothing has matched yet.
    expect(bufferTail(fakeTerm(rows), 5, 10)).toEqual([])
  })

  it('returns empty for an empty screen', () => {
    expect(bufferTail(fakeTerm(['', '', '']), 5)).toEqual([])
  })
})
