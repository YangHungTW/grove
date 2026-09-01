import { StringDecoder } from 'node:string_decoder'

/**
 * Minimal tmux control-mode (`tmux -CC`) protocol parser.
 *
 * In control mode tmux does NOT draw a screen; it emits a line-oriented text
 * protocol on stdout and reads tmux commands on stdin. The host renders each
 * pane's raw bytes itself — so xterm stays the single source of truth for the
 * screen (native scrollback / search / selection), exactly like a plain pty,
 * while the agent process lives on inside a persistent tmux session.
 *
 * This is a deliberately small subset (spike): enough to render one agent pane
 * and know when it dies. Protocol reference: `man tmux` CONTROL MODE + the tmux
 * wiki "Control-Mode" page. iTerm2's TmuxGateway.m is the canonical full impl.
 */

export interface TmuxControlEvents {
  /** A pane produced output (already octal-unescaped to real bytes/text). */
  onOutput: (paneId: string, data: string) => void
  /** The control client is exiting (tmux detached or quit). */
  onExit: (reason?: string) => void
  /** Reply body of a command we sent (between %begin and %end/%error). */
  onReply?: (num: number, lines: string[], error: boolean) => void
  /** tmux resized the window (`%layout-change`). NOT always our doing: any other
   * client attached to the same tmux session drags the window to its own size,
   * which silently shrinks the agent's drawing area inside our full-size pane. */
  onLayoutChange?: (windowId: string, cols: number, rows: number) => void
  /** A `%`-notification we don't handle — surfaced for debug logging. */
  onOther?: (line: string) => void
}

/**
 * Octal-unescape a `%output` value, operating on RAW BYTES (the parser reads the
 * stream as latin1, so each char is one byte 0x00–0xFF). Verified against tmux
 * 3.6a: only control bytes and backslash are escaped as octal `\xxx` (`\033`,
 * `\015`, `\134`) — all < 0x80. Printable UTF-8 (multibyte 你 / emoji / box-
 * drawing) is passed through literally as its raw bytes. This returns a byte
 * string; the caller runs it through a streaming UTF-8 decoder, which is what
 * lets a multibyte char that tmux split across two %output messages reassemble.
 */
export function unescapeOutput(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && /^[0-7]{3}$/.test(s.slice(i + 1, i + 4))) {
      out += String.fromCharCode(parseInt(s.slice(i + 1, i + 4), 8))
      i += 3
    } else {
      out += s[i]
    }
  }
  return out
}

/**
 * The window geometry out of a tmux layout string. The layout is
 * `<checksum>,<w>x<h>,<x>,<y>[,...]` — the FIRST `WxH` is the window itself
 * (later ones are its panes), e.g. `ae5d,80x23,0,0,0` for a window tmux has
 * dragged down to a stray 80x24 client's size.
 */
export function parseLayoutSize(layout: string): { cols: number; rows: number } | undefined {
  const m = /^[0-9a-f]+,(\d+)x(\d+),/.exec(layout.trim())
  return m ? { cols: Number(m[1]), rows: Number(m[2]) } : undefined
}

export class TmuxControlParser {
  private buf = ''
  private inBlock = false
  private blockNum = -1
  private blockLines: string[] = []
  // Persistent across %output messages: holds an incomplete trailing UTF-8
  // sequence so a multibyte char split by tmux's chunking reassembles cleanly.
  private readonly decoder = new StringDecoder('utf8')

  constructor(private readonly ev: TmuxControlEvents) {}

  /** Feed a raw chunk of the control connection's stdout. */
  feed(chunk: string): void {
    this.buf += chunk
    // tmux wraps control output in a DCS: a leading `\x1bP1000p` and a trailing
    // `\x1b\\` (ST). These are the only raw ESC bytes in the stream — pane content's
    // own ESCs arrive octal-escaped inside %output values — so stripping them is
    // safe and keeps the first %begin line parseable.
    if (this.buf.includes('\x1b')) {
      this.buf = this.buf.replace(/\x1bP1000p/g, '').replace(/\x1b\\/g, '')
    }
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      let line = this.buf.slice(0, nl)
      this.buf = this.buf.slice(nl + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    // Inside a command's %begin..%end/%error block: collect the reply body.
    if (this.inBlock) {
      if (line.startsWith('%end') || line.startsWith('%error')) {
        this.ev.onReply?.(this.blockNum, this.blockLines, line.startsWith('%error'))
        this.inBlock = false
        this.blockLines = []
      } else {
        this.blockLines.push(line)
      }
      return
    }

    if (!line.startsWith('%')) return // stray line — ignore

    if (line.startsWith('%begin')) {
      this.inBlock = true
      this.blockNum = Number(line.split(' ')[2] ?? -1)
      this.blockLines = []
      return
    }
    if (line.startsWith('%output ')) {
      const rest = line.slice('%output '.length)
      const sp = rest.indexOf(' ')
      if (sp < 0) return
      const bytes = Buffer.from(unescapeOutput(rest.slice(sp + 1)), 'latin1')
      this.ev.onOutput(rest.slice(0, sp), this.decoder.write(bytes))
      return
    }
    if (line.startsWith('%exit')) {
      this.ev.onExit(line.length > 6 ? line.slice(6) : undefined)
      return
    }
    if (line.startsWith('%layout-change ')) {
      // `%layout-change @0 <window-layout> <window-visible-layout> <flags>`
      const [, windowId, layout] = line.split(' ')
      const size = layout ? parseLayoutSize(layout) : undefined
      if (size) this.ev.onLayoutChange?.(windowId, size.cols, size.rows)
      return
    }
    // Everything else (%window-add, %session-changed, ...) is not needed to
    // render a single pane — surface for debug only.
    this.ev.onOther?.(line)
  }
}

/** Hex-encode arbitrary input bytes for `send-keys -H` (control-mode input). */
export function toSendKeysHex(data: string): string {
  return [...Buffer.from(data, 'utf8')].map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

/**
 * Input BYTES per `send-keys -H` command.
 *
 * `-H` spends one command ARGUMENT per byte, so a pasted document becomes a
 * single command line with tens of thousands of arguments — and tmux's parse of
 * that is badly superlinear. Measured against tmux 3.6b, round-trip for a paste
 * echoed back by the pane:
 *
 *     paste     one command        256-byte chunks
 *       8 KB    169 ms                    24 ms
 *      32 KB    never arrived             58 ms
 *     128 KB    never arrived            236 ms
 *
 * Above ~16 KB the paste is not merely slow, it is LOST — which is what a paste
 * that "types itself in one character at a time" and then stalls actually is.
 * Chunking is on BYTES, never on the JS string: splitting a string mid-character
 * would re-encode the halves as U+FFFD. tmux reassembles a multibyte character
 * split across two commands (verified byte-identical with CJK + emoji).
 */
export const SEND_KEYS_CHUNK_BYTES = 256

/** The `send-keys` commands that deliver `data` to a control-mode pane, in order. */
export function sendKeysCommands(target: string, data: string): string[] {
  const bytes = Buffer.from(data, 'utf8')
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += SEND_KEYS_CHUNK_BYTES) {
    const hex = [...bytes.subarray(i, i + SEND_KEYS_CHUNK_BYTES)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
    out.push(`send-keys -t ${target} -H ${hex}\n`)
  }
  return out
}
