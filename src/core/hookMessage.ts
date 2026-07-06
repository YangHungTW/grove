/**
 * User-facing toast text for a failed per-project worktree hook. Electron-free
 * and structural (takes the fields, not the IPC event type) so it stays in the
 * pure core and is unit-testable without the main/renderer layers.
 *
 * - `code === null` means the shell could not be spawned at all (vs a non-zero
 *   exit), so the wording distinguishes "could not start" from "exited N".
 * - `output` is the combined stdout+stderr tail; we surface only its LAST line —
 *   an interactive login shell prints prompt/plugin noise, and the actual error
 *   (e.g. `npm: command not found`) is almost always the final line.
 */
export function hookFailedMessage(e: {
  kind: 'create' | 'remove'
  code: number | null
  output: string
}): string {
  const label = e.kind === 'create' ? 'Create' : 'Remove'
  const why = e.code === null ? 'could not start' : `exited ${e.code}`
  const lastLine = e.output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
  const detail = lastLine ? ` — ${lastLine}` : ''
  return `${label}-worktree hook ${why}${detail}`
}
