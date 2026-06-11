import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { store } from './store'
import { parseUnifiedDiff, splitHunkRows, type DiffFile, type DiffHunk } from './diffParse'
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

/** One hunk rendered side-by-side: old text left, new text right. */
function SplitHunk({ hunk }: { hunk: DiffHunk }): JSX.Element {
  const rows = useMemo(() => splitHunkRows(hunk.lines), [hunk])
  return (
    <div className="diff-hunk">
      <div className="diff-line diff-line-hunk">{hunk.header}</div>
      {rows.map((r, ri) => (
        <div className="diff-srow" key={ri}>
          <span className={'diff-scell' + (r.left ? ` diff-scell-${r.left.type}` : ' diff-scell-empty')}>
            {r.left?.text ?? ''}
          </span>
          <span
            className={'diff-scell' + (r.right ? ` diff-scell-${r.right.type}` : ' diff-scell-empty')}
          >
            {r.right?.text ?? ''}
          </span>
        </div>
      ))}
    </div>
  )
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
  // Keyed by file path (not array index) so collapse state survives a Refresh
  // that reorders/adds files.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showIndex, setShowIndex] = useState(true)
  const [view, setView] = useState<'unified' | 'split'>('unified')
  const [auto, setAuto] = useState(true)
  const fileRefs = useRef<(HTMLDivElement | null)[]>([])
  // Files already shown once: a refresh must not re-collapse something the user
  // expanded (or re-expand what they collapsed) — only brand-new files get the
  // collapse-when-big default.
  const seenFiles = useRef<Set<string>>(new Set())

  // Per-file name + add/del counts, computed once per parse (used by both the
  // index and the body — no double O(N) walk).
  const metas = useMemo(
    () =>
      (files ?? []).map((f) => {
        const name = f.newPath && f.newPath !== '/dev/null' ? f.newPath : f.oldPath
        const { add, del } = counts(f)
        return { name, add, del, binary: !!f.binary }
      }),
    [files]
  )

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
        const parsed = parseUnifiedDiff(text)
        setFiles(parsed)
        setEmpty(text.trim().length === 0)
        // Collapse large files by default so a huge agent diff doesn't render
        // thousands of DOM nodes at once. Small files stay open; on refresh the
        // user's expand/collapse choices are kept for files already seen.
        const BIG = 400 // lines
        setCollapsed((prev) => {
          const next = new Set<string>()
          for (const f of parsed) {
            const key = f.newPath && f.newPath !== '/dev/null' ? f.newPath : f.oldPath
            const n = f.hunks.reduce((acc, h) => acc + h.lines.length, 0)
            if (seenFiles.current.has(key)) {
              if (prev.has(key)) next.add(key)
            } else if (n > BIG) {
              next.add(key)
            }
            seenFiles.current.add(key)
          }
          return next
        })
        fileRefs.current = []
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [session.filePath])

  useEffect(() => load(), [load])

  // Live review: re-pull the diff while the pane is visible so changes show up
  // as the agent makes them. Skipped when the window is hidden.
  useEffect(() => {
    if (!visible || !auto) return
    const t = setInterval(() => {
      if (!document.hidden) load()
    }, 5000)
    return () => clearInterval(t)
  }, [visible, auto, load])

  const toggle = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const jumpTo = (fi: number, key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(key) // expand the target so the jump lands on content
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
        <span style={{ marginLeft: 'auto' }} />
        <div className="diff-view-toggle" role="group" aria-label="Diff layout">
          <button
            className={view === 'unified' ? 'active' : ''}
            onClick={() => setView('unified')}
          >
            Unified
          </button>
          <button className={view === 'split' ? 'active' : ''} onClick={() => setView('split')}>
            Split
          </button>
        </div>
        <button
          className={'diff-auto' + (auto ? ' active' : '')}
          title="Re-pull the diff every 5s while this pane is visible"
          onClick={() => setAuto((v) => !v)}
        >
          Auto
        </button>
        <button className="diff-refresh" onClick={() => load()}>
          Refresh
        </button>
      </div>

      <div className="diff-main">
        {showIndex && hasFiles && (
          <div className="diff-index">
            {files!.map((_f, fi) => {
              const m = metas[fi]
              return (
                <button
                  className="diff-index-item"
                  key={fi}
                  title={m.name}
                  onClick={() => jumpTo(fi, m.name)}
                >
                  <span className="diff-index-name">{basename(m.name)}</span>
                  <span className="diff-index-stats">
                    {m.binary ? (
                      <span className="diff-bin-badge">bin</span>
                    ) : (
                      <>
                        <span className="diff-add-count">+{m.add}</span>
                        <span className="diff-del-count">−{m.del}</span>
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
              const m = metas[fi]
              const isCollapsed = collapsed.has(m.name)
              return (
                <div
                  className="diff-file"
                  key={fi}
                  ref={(el) => (fileRefs.current[fi] = el)}
                >
                  <button
                    className={'diff-file-header' + (isCollapsed ? ' collapsed' : '')}
                    onClick={() => toggle(m.name)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="diff-file-chevron">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="diff-file-path">{m.name}</span>
                    <span className="diff-file-stats">
                      {m.binary ? (
                        <span className="diff-bin-badge">bin</span>
                      ) : (
                        <>
                          <span className="diff-add-count">+{m.add}</span>
                          <span className="diff-del-count">−{m.del}</span>
                        </>
                      )}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="diff-file-body">
                      {f.binary && (
                        <div className="diff-line diff-binary-note">Binary file — no preview</div>
                      )}
                      {f.hunks.map((h, hi) =>
                        view === 'split' ? (
                          <SplitHunk key={hi} hunk={h} />
                        ) : (
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
                        )
                      )}
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
