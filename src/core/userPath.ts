import { isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'

/**
 * Normalize a path a human typed or pasted into an absolute filesystem path.
 * Viewer/IDE panes read files in the main process, whose cwd is NOT the worktree
 * — so a pasted relative path like `docs/readme.md` would resolve against the
 * wrong directory (or fail). Resolve it against `cwd` (the worktree) instead, and
 * also handle the rough edges of pasted input:
 *   - surrounding whitespace and a single pair of wrapping quotes
 *   - a `file://` URI prefix
 *   - a leading `~` / `~/` (the user's home directory)
 * An already-absolute path is returned normalized. `home` is injected so the
 * logic stays pure and unit-testable; callers pass `os.homedir()`.
 */
export function resolveUserPath(cwd: string, input: string, home: string = homedir()): string {
  let p = input.trim()
  // Strip one pair of wrapping quotes (drag-and-drop / shell copy often adds them).
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1)
  }
  if (p.startsWith('file://')) p = decodeURIComponent(p.slice('file://'.length))
  p = p.trim()
  if (!p) return p
  if (p === '~') p = home
  else if (p.startsWith('~/')) p = resolve(home, p.slice(2))
  return isAbsolute(p) ? resolve(p) : resolve(cwd, p)
}
