import { describe, it, expect } from 'vitest'
import { searchCoversScrollback } from './store'

/**
 * Off-screen terminal search. Grove uses the stock xterm SearchAddon, which
 * searches the WHOLE buffer (visible + scrollback) — so on the 'normal' buffer an
 * off-screen match is found and scrolled to. The observed "search only finds the
 * visible screen, you must scroll up first" happens when the running app (e.g.
 * Claude Code) drives the xterm ALTERNATE buffer: it owns its own screen/scroll,
 * so its transcript never enters xterm's scrollback and there is nothing for
 * SearchAddon to traverse. This is pre-existing and app-controlled (reproduces
 * without tmux), NOT a control-mode regression — Grove cannot search an app's
 * private scrollback. The rule below is what the UI uses to say so.
 */
describe('searchCoversScrollback', () => {
  it('covers scrollback on the normal buffer (off-screen matches reachable)', () => {
    expect(searchCoversScrollback('normal')).toBe(true)
  })

  it('cannot reach scrollback on the alternate buffer (visible screen only)', () => {
    expect(searchCoversScrollback('alternate')).toBe(false)
  })

  it('defaults to covered when the buffer type is unknown', () => {
    expect(searchCoversScrollback(undefined)).toBe(true)
  })
})
