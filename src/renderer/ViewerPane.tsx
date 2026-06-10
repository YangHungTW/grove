import { useEffect, useState, type CSSProperties } from 'react'
import { store } from './store'
import { renderMarkdown } from './markdown'
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

  useEffect(() => {
    let alive = true
    if (!session.filePath) {
      setError('No file path')
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
          className="viewer-markdown"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content, dirOf(session.filePath)) }}
        />
      )}
    </div>
  )
}
