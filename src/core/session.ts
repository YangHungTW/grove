import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { SessionKind, SessionState } from './types'

export interface PtySessionOptions {
  id?: string
  worktreeId: string
  kind: SessionKind
  /** Executable to run, e.g. 'bash' or 'claude'. */
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  cols?: number
  rows?: number
  title?: string
  /** Input written into the pty immediately after spawn (e.g. `claude\r`). */
  bootstrap?: string
  /** node-pty read encoding. Default 'utf8'. Control-mode (tmux -CC) sessions use
   * 'latin1' so node-pty does NOT UTF-8-decode the stream — the tmux protocol can
   * split a pane's multibyte char across two %output messages, which a premature
   * UTF-8 decode would turn into replacement chars. The control parser decodes the
   * reassembled pane bytes itself. */
  encoding?: string
}

export interface ExitInfo {
  exitCode: number
  signal?: number
}

type Unsubscribe = () => void

let counter = 0
function genId(): string {
  counter += 1
  return `p${counter}_${counter.toString(36)}`
}

/**
 * A PTY-backed session: thin lifecycle wrapper over node-pty that tracks
 * {@link SessionState} and fans out data/exit/state events. Electron-free so it
 * can be unit-tested under plain Node.
 */
export class PtySession {
  readonly id: string
  readonly worktreeId: string
  readonly kind: SessionKind
  title: string
  readonly cwd: string

  private readonly opts: PtySessionOptions
  private proc?: IPty
  private _state: SessionState = 'starting'

  private readonly dataCbs = new Set<(data: string) => void>()
  private readonly exitCbs = new Set<(info: ExitInfo) => void>()
  private readonly stateCbs = new Set<(state: SessionState) => void>()

  constructor(opts: PtySessionOptions) {
    this.opts = opts
    this.id = opts.id ?? genId()
    this.worktreeId = opts.worktreeId
    this.kind = opts.kind
    this.title = opts.title ?? opts.kind
    this.cwd = opts.cwd ?? process.cwd()
  }

  get state(): SessionState {
    return this._state
  }

  get pid(): number | undefined {
    return this.proc?.pid
  }

  /** Spawn the underlying pty. Idempotent: a no-op if already started. */
  start(): void {
    if (this.proc) return
    this.proc = pty.spawn(this.opts.command, this.opts.args ?? [], {
      name: 'xterm-256color',
      cols: this.opts.cols ?? 80,
      rows: this.opts.rows ?? 24,
      cwd: this.cwd,
      encoding: this.opts.encoding ?? 'utf8',
      env: { ...process.env, ...this.opts.env } as { [key: string]: string }
    })

    this.proc.onData((d) => {
      for (const cb of this.dataCbs) cb(d)
    })
    this.proc.onExit(({ exitCode, signal }) => {
      this.setState('exited')
      for (const cb of this.exitCbs) cb({ exitCode, signal })
    })

    this.setState('idle')

    // Delay the bootstrap command so the renderer can size the pty first; typing
    // into the shell before it knows its real width produces wrapped prompt junk.
    if (this.opts.bootstrap) {
      const bs = this.opts.bootstrap
      setTimeout(() => this.proc?.write(bs), 400)
    }
  }

  write(data: string): void {
    this.proc?.write(data)
  }

  resize(cols: number, rows: number): void {
    this.proc?.resize(cols, rows)
  }

  kill(signal?: string): void {
    this.proc?.kill(signal)
  }

  /** Update state and notify listeners (used by state-detection wiring). */
  setState(next: SessionState): void {
    if (next === this._state) return
    this._state = next
    for (const cb of this.stateCbs) cb(next)
  }

  onData(cb: (data: string) => void): Unsubscribe {
    this.dataCbs.add(cb)
    return () => this.dataCbs.delete(cb)
  }

  onExit(cb: (info: ExitInfo) => void): Unsubscribe {
    this.exitCbs.add(cb)
    return () => this.exitCbs.delete(cb)
  }

  onStateChange(cb: (state: SessionState) => void): Unsubscribe {
    this.stateCbs.add(cb)
    return () => this.stateCbs.delete(cb)
  }
}
