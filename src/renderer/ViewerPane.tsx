import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { store } from './store'
import { renderMarkdown } from './markdown'
import { renderMermaidIn } from './mermaidRender'
import type { SessionSnapshot } from '../main/ipc'

/** The directory portion of an absolute file path (for resolving relative images). */
function dirOf(p?: string): string | undefined {
  if (!p) return undefined
  const i = p.lastIndexOf('/')
  return i > 0 ? p.slice(0, i) : undefined
}

/**
 * A non-terminal pane that renders an opened file. Markdown is converted to
 * sanitized HTML and injected; HTML is shown in a sandboxed <iframe> so the
 * document is isolated from the renderer (it cannot reach `window.api` or the
 * parent origin). Read-only — no editing, no file-watching.
 */
export function ViewerPane({
  session,
  visible,
  column,
  focused
}: {
  session: SessionSnapshot
  visible: boolean
  column: number
  focused: boolean
}): JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mdRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    // Clear any state from a previous file so a stale error/content isn't shown
    // while the new file loads.
    setError(null)
    setContent(null)
    if (!session.filePath) {
      setError('No file path')
      return
    }
    // A web viewer loads its URL directly in the iframe — nothing to read.
    if (session.viewerKind === 'web') {
      setContent('')
      return
    }
    window.api
      .fileRead(session.filePath)
      .then((text) => {
        if (alive) setContent(text)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [session.filePath])

  const style: CSSProperties = visible
    ? { display: 'block', gridColumn: column }
    : { display: 'none' }

  // Render Markdown once per content/file change — not on every store notify
  // (marked + DOMPurify is non-trivial and ViewerPane re-renders on pty events).
  const markdownHtml = useMemo(
    () =>
      content != null && session.viewerKind !== 'html'
        ? renderMarkdown(content, dirOf(session.filePath))
        : '',
    [content, session.viewerKind, session.filePath]
  )

  // Render any mermaid diagrams once the HTML is in the DOM AND the pane is
  // visible — mermaid measures layout, so a display:none pane would render at
  // zero size. Re-runs when the pane becomes visible or the content changes.
  useEffect(() => {
    if (!visible || !markdownHtml || !mdRef.current) return
    void renderMermaidIn(mdRef.current, store.settings.background)
  }, [markdownHtml, visible])

  return (
    <div
      className={'pane viewer-pane' + (focused ? ' focused' : '')}
      data-kind="viewer"
      data-session-id={session.id}
      style={style}
      onMouseDown={() => store.focusSession(session.id)}
    >
      {error != null ? (
        <div className="viewer-error">Could not open file: {error}</div>
      ) : content == null ? (
        <div className="viewer-loading">Loading…</div>
      ) : session.viewerKind === 'web' ? (
        <iframe
          className="viewer-frame"
          title={session.title}
          // External page in its own (cross-)origin — isolated from Grove by the
          // same-origin policy. Sandbox grants what a normal site needs but NOT
          // top-navigation, so the page can't navigate Grove away.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          src={session.filePath}
        />
      ) : session.viewerKind === 'html' ? (
        <iframe
          className="viewer-frame"
          title={session.title}
          // Sandbox WITHOUT allow-same-origin: scripts may run but the frame sits
          // in an opaque origin, so it cannot touch window.api or the parent DOM.
          sandbox="allow-scripts"
          srcDoc={content}
        />
      ) : (
        <div
          ref={mdRef}
          className="viewer-markdown"
          dangerouslySetInnerHTML={{ __html: markdownHtml }}
        />
      )}
    </div>
  )
}
