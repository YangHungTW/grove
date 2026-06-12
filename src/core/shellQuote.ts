/** Single-quote a value for safe interpolation into a shell command line.
 * Any embedded single quote is closed, escaped, and reopened (`'\''`). Shared by
 * the main process (hook expansion) and the renderer (drag-and-drop file paths)
 * — Electron-free so both sides can import it. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
