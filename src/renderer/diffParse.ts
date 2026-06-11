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

/**
 * Decode git's C-style quoted path form (`"a/caf\303\251.txt"`), reassembling
 * octal `\NNN` escapes as UTF-8 bytes. Used as a fallback for any output where
 * `core.quotepath=false` wasn't applied (e.g. non-ASCII / control-char names).
 * A plain (unquoted) string is returned unchanged.
 */
function gitUnquote(s: string): string {
  if (!(s.startsWith('"') && s.endsWith('"') && s.length >= 2)) return s
  const body = s.slice(1, -1)
  const bytes: number[] = []
  const enc = new TextEncoder()
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && i + 1 < body.length) {
      const n = body[i + 1]
      if (n >= '0' && n <= '7') {
        bytes.push(parseInt(body.slice(i + 1, i + 4), 8))
        i += 3
      } else {
        const map: Record<string, string> = { t: '\t', n: '\n', r: '\r', '"': '"', '\\': '\\' }
        for (const b of enc.encode(map[n] ?? n)) bytes.push(b)
        i += 1
      }
    } else {
      for (const b of enc.encode(body[i])) bytes.push(b)
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

function stripPathPrefix(p: string): string {
  // `--- a/foo` / `+++ b/foo` → `foo`; leave `/dev/null` as-is. Trailing tab
  // (git pads renamed/spaced paths) and C-style quoting are handled first.
  const path = gitUnquote(p.trim().replace(/\t.*$/, ''))
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
      // Handle both the unquoted (`a/x b/x`) and git-quoted (`"a/x" "b/x"`) forms.
      const mq = /^diff --git "(.+)" "(.+)"$/.exec(line)
      const mu = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
      let oldPath = ''
      let newPath = ''
      if (mq) {
        oldPath = stripPathPrefix(`"${mq[1]}"`)
        newPath = stripPathPrefix(`"${mq[2]}"`)
      } else if (mu) {
        oldPath = mu[1]
        newPath = mu[2]
      }
      file = { oldPath, newPath, hunks: [] }
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
