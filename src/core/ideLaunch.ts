/** Pure logic for the Changes view's "open whole file in IDE" action
 * (Electron-free, unit-tested). Decides whether a configured editor is launched
 * as a GUI process or routed into an in-app shell session (terminal editors like
 * vim need a real TTY). The actual launching lives in the main process. */
import { shellQuote } from './shellQuote'
import type { IdeConfig } from './settings'
import type { CreateSessionRequest } from '../main/ipc'

export type { IdeConfig } from './settings'

/** Whether an IDE is configured enough to open a file (command non-empty). Drives
 * the enabled/disabled state of the per-file open icon in the diff view. */
export function canOpenInIde(settings: { ide?: IdeConfig }): boolean {
  return !!settings.ide && settings.ide.command.trim().length > 0
}

/** Known TUI editors that must run inside a terminal (used to infer `terminal`
 * for a custom command the user typed without ticking the box). */
export const TERMINAL_EDITORS = ['vim', 'nvim', 'vi', 'nano', 'hx', 'helix', 'emacs', 'kak', 'micro']

/** The leading binary of a command string (`code -g` → `code`, `/usr/bin/vim` → `vim`). */
function binaryOf(command: string): string {
  return (command.trim().split(/\s+/)[0] || '').split('/').pop() ?? ''
}

/** True when the editor must run inside a terminal: the explicit flag, or a
 * recognised TUI binary even if the flag wasn't set (custom-command convenience). */
export function isTerminalEditor(cfg: IdeConfig): boolean {
  return cfg.terminal || TERMINAL_EDITORS.includes(binaryOf(cfg.command))
}

/** Context the main process supplies so a session request can be built. */
export interface IdeOpenContext {
  worktreeId: string
  cwd: string
  cols?: number
}

/** Icon for the shell tab opened to host a terminal editor. */
export const IDE_SHELL_ICON = '✎'

/** What the main process should do to honour an open-in-IDE request:
 * - `session`: spawn an in-app shell pane that runs the (terminal) editor.
 * - `exec`: launch a GUI editor process; no pane is created. */
export type IdeOpenAction =
  | { mode: 'session'; request: CreateSessionRequest }
  | { mode: 'exec'; command: string; filePath: string }

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() || p
}

/**
 * Decide how to open `filePath` for the configured editor. Terminal editors get a
 * shell session whose bootstrap types `<command> <file>` (file shell-quoted);
 * GUI editors get an exec action carrying the command + path for the main process
 * to launch via a login shell.
 */
export function buildIdeOpenAction(
  cfg: IdeConfig,
  filePath: string,
  ctx: IdeOpenContext
): IdeOpenAction {
  const command = cfg.command.trim()
  if (isTerminalEditor(cfg)) {
    return {
      mode: 'session',
      request: {
        worktreeId: ctx.worktreeId,
        kind: 'shell',
        command: '',
        cwd: ctx.cwd,
        title: `${basename(filePath)} (${binaryOf(command)})`,
        icon: IDE_SHELL_ICON,
        cols: ctx.cols,
        bootstrap: `${command} ${shellQuote(filePath)}\r`
      }
    }
  }
  return { mode: 'exec', command, filePath }
}
