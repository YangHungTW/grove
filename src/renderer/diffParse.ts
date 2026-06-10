/** Minimal unified-diff parser for rendering a read-only diff view. */

export type DiffLineType = 'add' | 'del' | 'context'

export interface DiffLine {
  type: DiffLineType
  text: string
}
export interface DiffHunk {
  /** The `@@ -a,b +c,d @@` header line. */
  header: string
  lines: DiffLine[]
}
export interface DiffFile {
  oldPath: string
  newPath: string
  hunks: DiffHunk[]
  /** True for binary files (git emits "Binary files … differ", no hunks). */
  binary?: boolean
}

function stripPathPrefix(p: string): string {
  // `--- a/foo` / `+++ b/foo` → `foo`; leave `/dev/null` as-is.
  const path = p.trim().replace(/\t.*$/, '')
  if (path === '/dev/null') return path
  return path.replace(/^[ab]\//, '')
}

/**
 * Parse a unified diff (the output of `git diff`) into structured files → hunks
 * → typed lines. Unknown/metadata lines (index, mode, "\ No newline") are
 * skipped. Robust to multiple files concatenated together.
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git')) {
      // Seed paths from the header so files with no hunks (binary, pure
      // rename/mode change) still get a name — `---`/`+++` override below.
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
      file = { oldPath: m ? m[1] : '', newPath: m ? m[2] : '', hunks: [] }
      files.push(file)
      hunk = null
    } else if (line.startsWith('Binary files') && file) {
      file.binary = true
    } else if (line.startsWith('--- ')) {
      if (!file) {
        file = { oldPath: '', newPath: '', hunks: [] }
        files.push(file)
      }
      file.oldPath = stripPathPrefix(line.slice(4))
    } else if (line.startsWith('+++ ')) {
      if (file) file.newPath = stripPathPrefix(line.slice(4))
    } else if (line.startsWith('@@')) {
      if (!file) {
        file = { oldPath: '', newPath: '', hunks: [] }
        files.push(file)
      }
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
    } else if (hunk) {
      if (line.startsWith('+')) hunk.lines.push({ type: 'add', text: line.slice(1) })
      else if (line.startsWith('-')) hunk.lines.push({ type: 'del', text: line.slice(1) })
      else if (line.startsWith(' ')) hunk.lines.push({ type: 'context', text: line.slice(1) })
      // '\' (no-newline marker) and blank trailing lines are ignored.
    }
  }
  return files
}
