/** Lazy mermaid renderer for the Markdown viewer. mermaid is a heavy dependency,
 * so it's dynamically imported on first use (a doc with no diagrams never pays
 * for it). renderMarkdown() turns ```mermaid fences into `<pre class="mermaid">`
 * holders carrying the diagram source as text; this turns those into SVG. */

let initialized = false

/** Rough luminance test so the diagram theme matches a dark vs light viewer. */
export function isDarkBg(bg: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim())
  if (!m) return true // default to dark; Grove ships a dark theme
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return 0.299 * r + 0.587 * g + 0.114 * b < 128
}

/**
 * Render every not-yet-processed `pre.mermaid` holder inside `host` to SVG.
 * Safe to call repeatedly (mermaid marks processed nodes, and we skip them).
 * `securityLevel: 'strict'` keeps diagram labels sanitized and click handlers
 * disabled, since the source comes from arbitrary opened files. Bad diagrams are
 * left as their source text rather than throwing.
 */
export async function renderMermaidIn(host: HTMLElement, bg: string): Promise<void> {
  const nodes = Array.from(host.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed])'))
  if (nodes.length === 0) return
  const mermaid = (await import('mermaid')).default
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDarkBg(bg) ? 'dark' : 'default'
    })
    initialized = true
  }
  await mermaid.run({ nodes, suppressErrors: true })
}
