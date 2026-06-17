import { describe, it, expect } from 'vitest'
import { TmuxControlParser, unescapeOutput, toSendKeysHex } from './tmuxControl'

describe('unescapeOutput', () => {
  it('passes printable ASCII through literally', () => {
    expect(unescapeOutput('hello world')).toBe('hello world')
  })

  it('decodes octal byte escapes (ESC, backslash)', () => {
    // tmux escapes non-printable AND backslash as \xxx — \033 = ESC, \134 = "\"
    expect(unescapeOutput('\\033[1mbold\\033[0m')).toBe('[1mbold[0m')
    expect(unescapeOutput('a\\134b')).toBe('a\\b')
  })

  it('passes raw (latin1) bytes through and only resolves octal escapes', () => {
    // The parser reads the stream as latin1, so a value is a byte string: high
    // bytes (multibyte UTF-8) are literal; only control/backslash are escaped.
    expect(unescapeOutput('\xe4\xbd\xa0')).toBe('\xe4\xbd\xa0') // 你 bytes, untouched
    expect(unescapeOutput('\xe4\\012')).toBe('\xe4\n') // literal byte + octal LF
  })
})

describe('toSendKeysHex', () => {
  it('hex-encodes UTF-8 bytes space-separated', () => {
    expect(toSendKeysHex('hi')).toBe('68 69')
    expect(toSendKeysHex('\r')).toBe('0d')
    expect(toSendKeysHex('你')).toBe('e4 bd a0')
  })
})

describe('TmuxControlParser', () => {
  it('routes %output with the pane id and decoded bytes', () => {
    const out: Array<[string, string]> = []
    const p = new TmuxControlParser({ onOutput: (id, d) => out.push([id, d]), onExit: () => {} })
    p.feed('%output %1 hello\\015\\012\n')
    expect(out).toEqual([['%1', 'hello\r\n']])
  })

  it('decodes a multibyte UTF-8 char delivered whole in one %output', () => {
    const out: string[] = []
    const p = new TmuxControlParser({ onOutput: (_id, d) => out.push(d), onExit: () => {} })
    // 你好 as raw latin1 bytes: E4 BD A0 E5 A5 BD
    p.feed('%output %1 \xe4\xbd\xa0\xe5\xa5\xbd\n')
    expect(out.join('')).toBe('你好')
  })

  it('reassembles a multibyte char that tmux split across two %output messages', () => {
    const out: string[] = []
    const p = new TmuxControlParser({ onOutput: (_id, d) => out.push(d), onExit: () => {} })
    // 你 = E4 BD A0, split after the first two bytes — the bug that showed as "??"
    p.feed('%output %1 \xe4\xbd\n')
    p.feed('%output %1 \xa0\n')
    expect(out.join('')).toBe('你')
  })

  it('collects a %begin..%end block as a reply, not as output', () => {
    const out: string[] = []
    const replies: Array<{ lines: string[]; error: boolean }> = []
    const p = new TmuxControlParser({
      onOutput: (_id, d) => out.push(d),
      onExit: () => {},
      onReply: (_n, lines, error) => replies.push({ lines, error })
    })
    p.feed('%begin 123 7 1\n%1\n%end 123 7 1\n')
    expect(out).toEqual([])
    expect(replies).toEqual([{ lines: ['%1'], error: false }])
  })

  it('flags %error blocks', () => {
    const replies: Array<{ lines: string[]; error: boolean }> = []
    const p = new TmuxControlParser({
      onOutput: () => {},
      onExit: () => {},
      onReply: (_n, lines, error) => replies.push({ lines, error })
    })
    p.feed('%begin 1 2 1\nbad target\n%error 1 2 1\n')
    expect(replies[0].error).toBe(true)
  })

  it('fires onExit on %exit with the reason', () => {
    let reason: string | undefined = 'unset'
    const p = new TmuxControlParser({ onOutput: () => {}, onExit: (r) => (reason = r) })
    p.feed('%exit server exited\n')
    expect(reason).toBe('server exited')
  })

  it('handles a payload split across feed() chunks', () => {
    const out: string[] = []
    const p = new TmuxControlParser({ onOutput: (_id, d) => out.push(d), onExit: () => {} })
    p.feed('%output %2 par')
    p.feed('tial\n')
    expect(out).toEqual(['partial'])
  })

  it('strips the leading DCS wrapper so the first line parses', () => {
    const out: string[] = []
    const p = new TmuxControlParser({ onOutput: (_id, d) => out.push(d), onExit: () => {} })
    p.feed('\x1bP1000p%output %1 hi\n')
    expect(out).toEqual(['hi'])
  })

  it('surfaces unhandled notifications via onOther', () => {
    const others: string[] = []
    const p = new TmuxControlParser({
      onOutput: () => {},
      onExit: () => {},
      onOther: (l) => others.push(l)
    })
    p.feed('%window-add @3\n')
    expect(others).toEqual(['%window-add @3'])
  })
})
