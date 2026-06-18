/** Detect file paths in a line of terminal text so the renderer can make them
 * clickable (→ open a viewer tab). Pure (no DOM/xterm) so the matching is
 * unit-testable. Scoped to the extensions the viewer can render today —
 * Markdown and HTML — so a click always lands on something openable.
 *
 * A match keeps a trailing `:line[:col]` (claude prints `README.md:42`) inside
 * the clickable range but NOT in `path`, so the range underlines the whole token
 * while the viewer opens the bare file. */
export interface FileLinkMatch {
  /** The file path, with any `:line:col` suffix and wrapping punctuation removed. */
  path: string
  /** 0-based index of the clickable range start within the line. */
  index: number
  /** Length of the clickable range (includes a `:line` suffix if present). */
  length: number
}

// A run of path-ish characters ending in a viewer extension, plus an optional
// :line:col. Path chars exclude whitespace and shell/markup punctuation that
// commonly wraps a path (quotes, parens, brackets, backticks) so those don't
// get swallowed into the link.
const FILE_RE = /([~\w./@+-]+\.(?:md|markdown|html|htm))(:\d+(?::\d+)?)?/gi

export function findFileLinks(line: string): FileLinkMatch[] {
  const out: FileLinkMatch[] = []
  for (const m of line.matchAll(FILE_RE)) {
    out.push({ path: m[1], index: m.index ?? 0, length: m[0].length })
  }
  return out
}
