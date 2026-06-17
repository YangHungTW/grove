import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent
} from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { SearchAddon } from '@xterm/addon-search'
import { useStore } from './useStore'
import { store } from './store'
import { ViewerPane } from './ViewerPane'
import { DiffPane } from './DiffPane'
import { SearchBar } from './SearchBar'
import { filePathsFrom } from './fileDrop'
import { shiftEnterByte } from './termKeys'
import { shellQuote } from '../core/shellQuote'
import type { SessionSnapshot } from '../main/ipc'

export function PaneGrid(): JSX.Element {
  const s = useStore()
  const { cols } = s.computeGrid()
  const panes = s.visiblePanes() // [{ id, group }] — one active pane per column
  const colOf = new Map(panes.map((p) => [p.id, p.group + 1]))
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  function startDrag(e: MouseEvent, i: number): void {
    e.preventDefault()
    const fr = store.colFr.slice()
    const rect = ref.current!.getBoundingClientRect()
    const px = rect.width / fr.reduce((a, b) => a + b, 0)
    const start = e.clientX
    const a0 = fr[i]
    const b0 = fr[i + 1]
    const min = 0.18
    const onMove = (ev: globalThis.MouseEvent): void => {
      let d = (ev.clientX - start) / px
      d = Math.max(-(a0 - min), Math.min(b0 - min, d))
      const next = fr.slice()
      next[i] = a0 + d
      next[i + 1] = b0 - d
      store.setFractions(next, store.rowFr)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const gutters: JSX.Element[] = []
  const ctot = s.colFr.reduce((a, b) => a + b, 0) || 1
  let acc = 0
  for (let i = 0; i < cols - 1; i++) {
    acc += s.colFr[i]
    gutters.push(
      <div
        key={'c' + i}
        className="gutter gutter-col"
        style={{ left: (size.w * acc) / ctot - 3 }}
        onMouseDown={(e) => startDrag(e, i)}
      />
    )
  }

  const style: CSSProperties = {
    gridTemplateColumns: s.colFr.map((f) => `${f}fr`).join(' ')
  }

  return (
    <div id="panes" ref={ref} style={style} className={cols <= 1 ? 'single' : ''}>
      {[...s.sessions.values()].map((sess) =>
        sess.kind === 'viewer' ? (
          <ViewerPane
            key={sess.id}
            session={sess}
            visible={colOf.has(sess.id)}
            column={colOf.get(sess.id) ?? 1}
            focused={sess.id === s.focusedSessionId}
          />
        ) : sess.kind === 'diff' ? (
          <DiffPane
            key={sess.id}
            session={sess}
            visible={colOf.has(sess.id)}
            column={colOf.get(sess.id) ?? 1}
            focused={sess.id === s.focusedSessionId}
          />
        ) : (
          <Pane
            key={sess.id}
            session={sess}
            visible={colOf.has(sess.id)}
            column={colOf.get(sess.id) ?? 1}
            focused={sess.id === s.focusedSessionId}
            transparent={s.settings.transparent}
            searching={sess.id === s.searchSessionId}
            settling={s.isSettling(sess.id)}
          />
        )
      )}
      {gutters}
    </div>
  )
}

function Pane({
  session,
  visible,
  column,
  focused,
  transparent,
  searching,
  settling
}: {
  session: SessionSnapshot
  visible: boolean
  column: number
  focused: boolean
  transparent: boolean
  searching: boolean
  settling: boolean
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // Move keyboard focus to this terminal whenever it becomes the focused
  // session — covers both newly-created sessions and tab switches.
  useEffect(() => {
    if (focused) requestAnimationFrame(() => termRef.current?.focus())
  }, [focused])

  // Drag a file from Finder onto the terminal → type its (shell-quoted) path,
  // like Terminal.app/iTerm. Electron would otherwise try to open the dropped
  // file and navigate the window away; preventDefault stops that.
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const paths = filePathsFrom(e.dataTransfer).map(shellQuote)
    if (!paths.length) return
    window.api.sessionInput(session.id, paths.join(' ') + ' ')
    store.focusSession(session.id)
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const font = store.terminalFont()
    const term = new Terminal({
      convertEol: true,
      fontSize: font.fontSize,
      fontFamily: font.fontFamily,
      cursorBlink: true,
      // Solid theme background + foreground so agents that don't paint a full
      // background (e.g. agy/antigravity) show the theme colour, not a flat fill.
      allowTransparency: store.settings.transparent,
      theme: store.terminalTheme(),
      // Disable reflow on resize (Terminal.app-style truncation). Re-wrapping
      // the buffer desyncs zsh's cursor-row bookkeeping for multi-line / right
      // prompts, so every split/zoom width change left a stale prompt copy
      // behind. TUI agents repaint themselves on SIGWINCH, so they're
      // unaffected; old scrollback simply keeps its original wrap points.
      windowsMode: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const search = new SearchAddon()
    term.loadAddon(search)
    term.open(el)
    term.onData((d) => window.api.sessionInput(session.id, d))
    // Shift+Enter inserts a newline instead of submitting. xterm sends plain CR
    // (\r = submit) for both Enter and Shift+Enter; send LF (\x0a) instead, which
    // is exactly what agents like claude treat as "newline" (its chat:newline is
    // Ctrl+J = LF). Returning false stops xterm from also sending the CR. Attached
    // for shell panes too, so it keeps working when an agent is launched by hand
    // inside a shell (a plain shell binds both CR and LF to accept-line anyway).
    if (session.kind === 'agent' || session.kind === 'shell') {
      term.attachCustomKeyEventHandler((e) => {
        const byte = shiftEnterByte(e)
        if (byte === null) return true
        if (byte) window.api.sessionInput(session.id, byte)
        return false
      })
    }
    termRef.current = term
    store.registerPane(session.id, term, fit, search)

    // Fit whenever this pane actually has a box — fires on display:none→block
    // (worktree/tab switch, split), grid drag, and window resize. The resize
    // also sends SIGWINCH so full-screen TUI agents repaint.
    //
    // The pty notification is DEBOUNCED: a single split/zoom toggle changes the
    // pane's box several times in a burst (grid columns, gutters, fraction
    // reset), and forwarding every intermediate size sends a SIGWINCH per step
    // — zsh/p10k redraws its prompt on each one, stacking stale prompts in the
    // scrollback. The xterm box still fits immediately; only the final
    // geometry reaches the shell. The first resize is sent right away so a
    // fresh session's prompt renders at the correct width.
    let resizeTimer: number | undefined
    let lastSent = { cols: -1, rows: -1 }
    const sendResize = (): void => {
      const { cols, rows } = term
      if (cols === lastSent.cols && rows === lastSent.rows) return
      lastSent = { cols, rows }
      window.api.sessionResize(session.id, cols, rows)
    }
    const refit = (): void => {
      if (el.clientHeight < 2 || el.clientWidth < 2) return
      try {
        // Compute the target size and resize ONCE. (fit.fit() followed by a
        // shrink would reflow the buffer twice per layout change — the row
        // bounce desyncs zsh's cursor-row bookkeeping, so its SIGWINCH prompt
        // redraw clears the wrong region and stale prompt copies pile up.)
        const dims = fit.proposeDimensions()
        if (dims && dims.cols >= 2 && dims.rows >= 2) {
          // Reserve one row so an agent's bottom line (claude's status /
          // auto-mode row) isn't flush against the pane edge. The canvas sits
          // at top:0, so a shorter terminal just leaves a clean bottom margin.
          const rows = dims.rows > 4 ? dims.rows - 1 : dims.rows
          if (term.cols !== dims.cols || term.rows !== rows) {
            term.resize(dims.cols, rows)
            term.refresh(0, term.rows - 1) // full repaint (new/reshown pane)
          }
        }
      } catch {
        /* ignore transient measure errors */
      }
      if (lastSent.cols < 0) {
        sendResize()
      } else {
        window.clearTimeout(resizeTimer)
        resizeTimer = window.setTimeout(sendResize, 120)
      }
    }
    const ro = new ResizeObserver(refit)
    ro.observe(el)

    // The terminal may first fit with a fallback font (smaller cells → too many
    // rows). Once the bundled Nerd Font is ready, cell metrics change, so refit.
    let alive = true
    void document.fonts.ready.then(() => {
      if (alive) refit()
    })

    return () => {
      alive = false
      window.clearTimeout(resizeTimer)
      ro.disconnect()
      store.unregisterPane(session.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // Renderer choice depends on transparency, and re-runs when it toggles:
  //  - opaque  → WebGL: lowest input latency (canvas 2D repaints per keystroke
  //    and feels laggy on Retina). Force a refresh on attach (WebGL can leave a
  //    fresh pane unpainted) and fall back to canvas on GPU context loss.
  //  - transparent → Canvas: xterm's WebGL renderer ignores allowTransparency
  //    (paints an opaque background), so it would defeat the see-through effect.
  //    Canvas renders the rgba background transparent while keeping text fully
  //    opaque — exactly "background shows through, glyphs stay solid".
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    let addon: { dispose(): void } | null = null
    const loadCanvas = (): void => {
      try {
        const c = new CanvasAddon()
        term.loadAddon(c)
        addon = c
        term.refresh(0, term.rows - 1)
      } catch {
        /* keep DOM renderer */
      }
    }
    if (transparent) {
      loadCanvas()
    } else {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          try {
            webgl.dispose()
          } catch {
            /* ignore */
          }
          loadCanvas()
        })
        term.loadAddon(webgl)
        addon = webgl
        term.refresh(0, term.rows - 1)
      } catch {
        // WebGL unavailable (software rendering / blocklisted GPU) — use canvas.
        loadCanvas()
      }
    }
    return () => {
      try {
        addon?.dispose()
      } catch {
        /* term may already be disposed */
      }
    }
  }, [session.id, transparent])

  return (
    <div
      className={
        'pane' +
        (focused ? ' focused' : '') +
        (dragOver ? ' drag-over' : '') +
        (settling ? ' settling' : '')
      }
      data-session-id={session.id}
      style={visible ? { display: 'block', gridColumn: column } : { display: 'none' }}
      ref={ref}
      onMouseDown={() => store.focusSession(session.id)}
      onDragOver={(e) => {
        // Must preventDefault on dragover or the drop event never fires.
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        // Ignore leaves into child nodes (xterm layers); only clear on real exit.
        if (!ref.current?.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      {searching && <SearchBar sessionId={session.id} />}
      {dragOver && <div className="pane-drop-hint">Drop to paste file path</div>}
    </div>
  )
}
