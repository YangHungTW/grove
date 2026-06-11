import { useEffect, useRef, useState } from 'react'
import { store } from './store'
import { XIcon } from './Icons'

/** Floating find bar for a terminal pane (xterm SearchAddon). Opens with ⌘F on
 * the focused terminal; Enter / ⇧Enter step through matches, Esc closes and
 * returns focus to the terminal. */
export function SearchBar({ sessionId }: { sessionId: string }): JSX.Element {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const find = (query: string, dir: 1 | -1, incremental = false): void => {
    const pane = store.panes.get(sessionId)
    if (!pane?.search) return
    if (!query) {
      pane.search.clearDecorations()
      pane.term.clearSelection()
      return
    }
    const opts = { incremental, caseSensitive: false }
    if (dir === 1) pane.search.findNext(query, opts)
    else pane.search.findPrevious(query, opts)
  }

  return (
    <div className="term-search" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="term-search-input"
        value={q}
        placeholder="Find…"
        spellCheck={false}
        onChange={(e) => {
          setQ(e.target.value)
          find(e.target.value, 1, true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') find(q, e.shiftKey ? -1 : 1)
          else if (e.key === 'Escape') store.closeSearch()
          e.stopPropagation()
        }}
      />
      <button className="term-search-btn" title="Previous match (⇧Enter)" onClick={() => find(q, -1)}>
        ↑
      </button>
      <button className="term-search-btn" title="Next match (Enter)" onClick={() => find(q, 1)}>
        ↓
      </button>
      <button className="term-search-btn" title="Close (Esc)" onClick={() => store.closeSearch()}>
        <XIcon size={11} />
      </button>
    </div>
  )
}
