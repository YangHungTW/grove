import { marked } from 'marked'
import createDOMPurify from 'dompurify'

// Bind DOMPurify to the active window LAZILY (on first render, not at import).
// The default export only auto-binds when a global `window` exists at import
// time; a test DOM (happy-dom) injects `window` after module evaluation, so we
// defer binding until first use, by which point the DOM is present.
type WindowLike = Parameters<typeof createDOMPurify>[0]
let purify: ReturnType<typeof createDOMPurify> | null = null
function purifier(): ReturnType<typeof createDOMPurify> {
  if (!purify) {
    purify = createDOMPurify(
      typeof window !== 'undefined' ? (window as unknown as WindowLike) : undefined
    )
  }
  return purify
}

/**
 * Render Markdown to a SANITIZED HTML string. `marked` does no sanitization of
 * its own (it dropped the built-in `sanitize` option years ago), so the raw HTML
 * — including any inline HTML the document embedded — is run through DOMPurify.
 * This strips the classic `<img src=x onerror=…>` / `<script>` XSS vectors while
 * keeping ordinary formatting (headings, lists, code, links, images).
 *
 * `baseDir` (the absolute directory of the source file) makes relative image
 * paths resolve against the FILE, not the app's HTML — otherwise a README's
 * `![logo](assets/x.svg)` would 404. Relative srcs are rewritten to absolute
 * `file://` URLs AFTER sanitization (so DOMPurify still vets the markup).
 */
export function renderMarkdown(md: string, baseDir?: string): string {
  const raw = marked.parse(md, { async: false }) as string
  const clean = purifier().sanitize(raw)
  if (!baseDir || typeof document === 'undefined') return clean

  const tpl = document.createElement('template')
  tpl.innerHTML = clean
  tpl.content.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') ?? ''
    // Leave absolute URLs (scheme:, //, #anchor, data:) untouched.
    if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('#')) {
      return
    }
    // encodeURI so spaces / unicode / '#' in the path don't break the file://
    // URL (Chromium rejects unencoded spaces); it preserves '/' and ':'.
    const abs = src.startsWith('/')
      ? `file://${encodeURI(src)}`
      : `file://${encodeURI(baseDir)}/${encodeURI(src)}`
    img.setAttribute('src', abs)
  })
  return tpl.innerHTML
}
