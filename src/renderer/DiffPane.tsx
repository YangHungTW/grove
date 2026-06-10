import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { store } from './store'
import { parseUnifiedDiff, type DiffFile } from './diffParse'
import type { SessionSnapshot } from '../main/ipc'

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() || p
}

/** Per-file added / removed line counts (for the index + file headers). */
function counts(f: DiffFile): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const h of f.hunks)
    for (const l of h.lines) {
      if (l.type === 'add') add++
      else if (l.type === 'del') del++
    }
  return { add, del }
}

/**
 * A read-only code-review pane showing what a worktree changed, rendered from a
 * unified `git diff`. Each file is a collapsible accordion, and a GitHub-style
 * changed-files index on the left (toggleable) jumps to a file. The worktree
 * path is carried on `session.filePath`. Line text renders as React children, so
 * it is HTML-escaped automatically (no injection from `+`/`-` lines).
 */
export function DiffPane({
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
  const [files, setFiles] = useState<DiffFile[] | null>(null)
  const [empty, setEmpty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [showIndex, setShowIndex] = useState(true)
  const fileRefs = useRef<(HTMLDivElement | null)[]>([])

  const load = useCallback(() => {
    const path = session.filePath
    if (!path) {
      setError('No worktree path')
      return
    }
    setError(null)
    window.api
      .worktreeDiff(path)
      .then((text) => {
        setFiles(parseUnifiedDiff(text))
        setEmpty(text.trim().length === 0)
        setCollapsed(new Set()) // start fully expanded
        fileRefs.current = []
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [session.filePath])

  useEffect(() => load(), [load])

  const toggle = (fi: number): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(fi)) next.delete(fi)
      else next.add(fi)
      return next
    })

  const jumpTo = (fi: number): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(fi) // expand the target so the jump lands on content
      return next
    })
    requestAnimationFrame(() =>
      fileRefs.current[fi]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    )
  }

  const style: CSSProperties = visible
    ? { display: 'flex', gridColumn: column }
    : { display: 'none' }

  const hasFiles = files != null && files.length > 0

  return (
    <div
      className={'pane diff-pane' + (focused ? ' focused' : '')}
      data-kind="diff"
      data-session-id={session.id}
      style={style}
      onMouseDown={() => store.focusSession(session.id)}
    >
      <div className="diff-toolbar">
        <button
          className={'diff-index-toggle' + (showIndex ? ' active' : '')}
          aria-label="Toggle changed-files index"
          title="Show/hide the changed-files list"
          disabled={!hasFiles}
          onClick={() => setShowIndex((v) => !v)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M2 3h4v10H2V3Zm5 1h7v1.5H7V4Zm0 3.25h7v1.5H7v-1.5ZM7 10.5h7V12H7v-1.5Z" />
          </svg>
        </button>
        <span className="diff-toolbar-title">Changes</span>
        {hasFiles && (
          <span className="diff-toolbar-count">
            {files!.length} file{files!.length > 1 ? 's' : ''}
          </span>
        )}
        <button className="diff-refresh" onClick={() => load()}>
          Refresh
        </button>
      </div>

      <div className="diff-main">
        {showIndex && hasFiles && (
          <div className="diff-index">
            {files!.map((f, fi) => {
              const c = counts(f)
              const name = f.newPath && f.newPath !== '/dev/null' ? f.newPath : f.oldPath
              return (
                <button
                  className="diff-index-item"
                  key={fi}
                  title={name}
                  onClick={() => jumpTo(fi)}
                >
                  <span className="diff-index-name">{basename(name)}</span>
                  <span className="diff-index-stats">
                    {f.binary ? (
                      <span className="diff-bin-badge">bin</span>
                    ) : (
                      <>
                        <span className="diff-add-count">+{c.add}</span>
                        <span className="diff-del-count">−{c.del}</span>
                      </>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="diff-body">
          {error != null ? (
            <div className="diff-error">Could not load diff: {error}</div>
          ) : files == null ? (
            <div className="diff-loading">Loading…</div>
          ) : empty || files.length === 0 ? (
            <div className="diff-empty">No changes in this worktree.</div>
          ) : (
            files.map((f, fi) => {
              const c = counts(f)
              const name = f.newPath && f.newPath !== '/dev/null' ? f.newPath : f.oldPath
              const isCollapsed = collapsed.has(fi)
              return (
                <div
                  className="diff-file"
                  key={fi}
                  ref={(el) => (fileRefs.current[fi] = el)}
                >
                  <button
                    className={'diff-file-header' + (isCollapsed ? ' collapsed' : '')}
                    onClick={() => toggle(fi)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="diff-file-chevron">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="diff-file-path">{name}</span>
                    <span className="diff-file-stats">
                      {f.binary ? (
                        <span className="diff-bin-badge">bin</span>
                      ) : (
                        <>
                          <span className="diff-add-count">+{c.add}</span>
                          <span className="diff-del-count">−{c.del}</span>
                        </>
                      )}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="diff-file-body">
                      {f.binary && (
                        <div className="diff-line diff-binary-note">Binary file — no preview</div>
                      )}
                      {f.hunks.map((h, hi) => (
                        <div className="diff-hunk" key={hi}>
                          <div className="diff-line diff-line-hunk">{h.header}</div>
                          {h.lines.map((l, li) => (
                            <div className={`diff-line diff-line-${l.type}`} key={li}>
                              <span className="diff-gutter">
                                {l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}
                              </span>
                              <span className="diff-text">{l.text}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
