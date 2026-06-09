import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { useStore } from './useStore'
import { store } from './store'
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
      {[...s.sessions.values()].map((sess) => (
        <Pane
          key={sess.id}
          session={sess}
          visible={colOf.has(sess.id)}
          column={colOf.get(sess.id) ?? 1}
          focused={sess.id === s.focusedSessionId}
        />
      ))}
      {gutters}
    </div>
  )
}

function Pane({
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
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  // Move keyboard focus to this terminal whenever it becomes the focused
  // session — covers both newly-created sessions and tab switches.
  useEffect(() => {
    if (focused) requestAnimationFrame(() => termRef.current?.focus())
  }, [focused])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: '"MesloLGS NF", "MesloLGS Nerd Font", Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      // Solid theme background + foreground so agents that don't paint a full
      // background (e.g. agy/antigravity) show the theme colour, not a flat fill.
      allowTransparency: store.settings.transparent,
      theme: store.terminalTheme()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    // Canvas renderer: the DOM renderer mis-draws box-drawing glyphs (claude's
    // ─/│ frame lines showed as garbage). The canvas addon draws them correctly
    // (customGlyphs) and — unlike WebGL — repaints reliably on a fresh pane.
    try {
      term.loadAddon(new CanvasAddon())
    } catch {
      /* keep DOM renderer */
    }
    term.onData((d) => window.api.sessionInput(session.id, d))
    termRef.current = term
    store.registerPane(session.id, term, fit)

    // Fit whenever this pane actually has a box — fires on display:none→block
    // (worktree/tab switch, split), grid drag, and window resize. The resize
    // also sends SIGWINCH so full-screen TUI agents repaint.
    const refit = (): void => {
      if (el.clientHeight < 2 || el.clientWidth < 2) return
      try {
        fit.fit()
        // Reserve one row so an agent's bottom line (claude's status / auto-mode
        // row) isn't flush against the pane edge. The canvas sits at top:0, so a
        // shorter terminal just leaves a clean margin at the bottom.
        if (term.rows > 4) term.resize(term.cols, term.rows - 1)
        window.api.sessionResize(session.id, term.cols, term.rows)
        term.refresh(0, term.rows - 1) // force a full repaint (new/reshown pane)
      } catch {
        /* ignore transient measure errors */
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
      ro.disconnect()
      store.unregisterPane(session.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  return (
    <div
      className={'pane' + (focused ? ' focused' : '')}
      data-session-id={session.id}
      style={visible ? { display: 'block', gridColumn: column } : { display: 'none' }}
      ref={ref}
      onMouseDown={() => store.focusSession(session.id)}
    />
  )
}
