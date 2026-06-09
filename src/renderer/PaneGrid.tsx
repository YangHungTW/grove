import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { useStore } from './useStore'
import { store } from './store'
import type { SessionSnapshot } from '../main/ipc'

export function PaneGrid(): JSX.Element {
  const s = useStore()
  const { cols, rows, visible } = s.computeGrid()
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // Track the grid container size so gutters can be positioned. Per-pane
  // ResizeObservers (in <Pane>) handle fitting — robust to display/grid changes.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  function startDrag(e: MouseEvent, axis: 'col' | 'row', i: number): void {
    e.preventDefault()
    const isCol = axis === 'col'
    const fr = (isCol ? store.colFr : store.rowFr).slice()
    const rect = ref.current!.getBoundingClientRect()
    const px = (isCol ? rect.width : rect.height) / fr.reduce((a, b) => a + b, 0)
    const start = isCol ? e.clientX : e.clientY
    const a0 = fr[i]
    const b0 = fr[i + 1]
    const min = 0.15
    const onMove = (ev: globalThis.MouseEvent): void => {
      let d = ((isCol ? ev.clientX : ev.clientY) - start) / px
      d = Math.max(-(a0 - min), Math.min(b0 - min, d))
      const next = fr.slice()
      next[i] = a0 + d
      next[i + 1] = b0 - d
      if (isCol) store.setFractions(next, store.rowFr)
      else store.setFractions(store.colFr, next)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const gutters: JSX.Element[] = []
  const ctot = s.colFr.reduce((a, b) => a + b, 0)
  let acc = 0
  for (let i = 0; i < cols - 1; i++) {
    acc += s.colFr[i]
    gutters.push(
      <div
        key={'c' + i}
        className="gutter gutter-col"
        style={{ left: (size.w * acc) / ctot - 3 }}
        onMouseDown={(e) => startDrag(e, 'col', i)}
      />
    )
  }
  const rtot = s.rowFr.reduce((a, b) => a + b, 0)
  acc = 0
  for (let i = 0; i < rows - 1; i++) {
    acc += s.rowFr[i]
    gutters.push(
      <div
        key={'r' + i}
        className="gutter gutter-row"
        style={{ top: (size.h * acc) / rtot - 3 }}
        onMouseDown={(e) => startDrag(e, 'row', i)}
      />
    )
  }

  const style: CSSProperties = {
    gridTemplateColumns: s.colFr.map((f) => `${f}fr`).join(' '),
    gridTemplateRows: s.rowFr.map((f) => `${f}fr`).join(' ')
  }

  return (
    <div id="panes" ref={ref} style={style} className={visible.length <= 1 ? 'single' : ''}>
      {[...s.sessions.values()].map((sess) => (
        <Pane
          key={sess.id}
          session={sess}
          visible={visible.includes(sess.id)}
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
  focused
}: {
  session: SessionSnapshot
  visible: boolean
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
      style={{ display: visible ? 'block' : 'none' }}
      ref={ref}
      onMouseDown={() => store.focusSession(session.id)}
    />
  )
}
