/** Turn a raw Node filesystem error from reading a viewer file into a short,
 * human-readable message that names the path Grove actually looked at. Pure (no
 * Node/DOM) so it is unit-testable and can run in either process.
 *
 * The path matters: a viewer opens an agent-printed link resolved against the
 * worktree, so when it fails the user's first question is "which path did it
 * try?". A bare `ENOENT` buries that; this surfaces it. */
export function describeViewerReadError(err: unknown, filePath: string): string {
  const code = (err as { code?: string } | null)?.code
  switch (code) {
    case 'ENOENT':
      return `File not found: ${filePath}`
    case 'EISDIR':
      return `That path is a folder, not a file: ${filePath}`
    case 'EACCES':
    case 'EPERM':
      return `Permission denied reading ${filePath}`
    case 'ENAMETOOLONG':
      return `Path is too long: ${filePath}`
    default: {
      const msg = err instanceof Error ? err.message : err == null ? '' : String(err)
      return `Could not read ${filePath}${msg ? ` (${msg})` : ''}`
    }
  }
}
