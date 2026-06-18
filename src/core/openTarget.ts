/** Helpers for the "open file / open URL" entry point. Pure (no DOM/Node) so the
 * classification and the framing heuristic are unit-testable. */

/** Is this an http(s) URL? (Trimmed; case-insensitive scheme.) */
export function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim())
}

/**
 * Decide whether an external page can be shown inside an <iframe> from Grove's
 * own (file://) origin, from its response headers. Used to fall back to the
 * external browser for sites that refuse framing instead of showing a blank pane.
 *
 * Returns false when the site sends `X-Frame-Options: DENY|SAMEORIGIN|ALLOW-FROM`
 * or a CSP `frame-ancestors` that isn't a wildcard (`'none'`, `'self'`, or an
 * explicit host list never matches our file:// origin). Absent/permissive
 * headers → true (optimistic: prefer embedding, which is what the user wants).
 */
export function parseFrameability(xfo: string | null, csp: string | null): boolean {
  if (xfo) {
    const v = xfo.toLowerCase()
    if (v.includes('deny') || v.includes('sameorigin') || v.includes('allow-from')) return false
  }
  if (csp) {
    const directive = csp
      .toLowerCase()
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('frame-ancestors'))
    if (directive) {
      const sources = directive.slice('frame-ancestors'.length).trim()
      if (sources === '' || sources === "'none'") return false
      if (sources.includes('*')) return true
      // 'self' or an explicit host list — our file:// origin won't be in it.
      return false
    }
  }
  return true
}
