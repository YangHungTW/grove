/**
 * The in-app HTML viewer serves agent-generated reports over a dedicated
 * scheme. Loading a report this way (rather than via `<iframe srcdoc>`) gives
 * the document its OWN origin, so it does not inherit the renderer's CSP
 * (`script-src 'self'`) — without that, the report's inline <script> (TOC
 * scrolling, collapsibles, etc.) is silently blocked.
 *
 * The URL pathname IS the file's absolute path, encoded per segment so spaces,
 * '#' or '?' survive the round-trip. Because relative assets resolve against
 * the same scheme, a report's `./style.css` / `img/x.png` load too.
 *
 * `htmlViewerSrc` (renderer) and `htmlViewerPath` (main) are exact inverses.
 */
export const HTML_VIEWER_SCHEME = 'grove-html'

/** Fixed host; the meaningful part is the pathname (the absolute file path). */
const HOST = 'open'

/** Absolute file path → `grove-html://open/...` URL for an <iframe src>. */
export function htmlViewerSrc(absPath: string): string {
  const path = absPath.split('/').map(encodeURIComponent).join('/')
  return `${HTML_VIEWER_SCHEME}://${HOST}${path.startsWith('/') ? '' : '/'}${path}`
}

/** `grove-html://open/...` URL → the absolute file path it points at. */
export function htmlViewerPath(url: string): string {
  return decodeURIComponent(new URL(url).pathname)
}
