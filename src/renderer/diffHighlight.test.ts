import { describe, it, expect } from 'vitest'
import hljs from 'highlight.js/lib/common'
import { EXT_LANG, extToLang, highlightDiffLine } from './diffHighlight'

describe('EXT_LANG only names registered languages', () => {
  // The module imports 'highlight.js/lib/common' (plus a couple of individually
  // registered grammars) to keep the full 190-grammar build out of the renderer
  // chunk. An unregistered id would silently fall back to plain text, so pin
  // every mapped id to a grammar the module actually registered. hljs/lib/common
  // is a singleton, so the module's registerLanguage calls are visible here.
  it('every mapped language id resolves via hljs.getLanguage', () => {
    for (const id of new Set(Object.values(EXT_LANG))) {
      expect(hljs.getLanguage(id), `EXT_LANG id "${id}" is not registered`).toBeDefined()
    }
  })
})

describe('extToLang', () => {
  it('maps known extensions to highlight.js language ids', () => {
    expect(extToLang('src/foo.ts')).toBe('typescript')
    expect(extToLang('a/b/c.py')).toBe('python')
    expect(extToLang('Component.tsx')).toBe('typescript')
    expect(extToLang('page.html')).toBe('xml')
  })
  it('returns undefined for unknown or missing extensions', () => {
    expect(extToLang('file.unknownext')).toBeUndefined()
    expect(extToLang('noextension')).toBeUndefined()
  })
})

describe('highlightDiffLine', () => {
  it('emits hljs token spans for a known language, keeping the characters', () => {
    const out = highlightDiffLine('const x = 1', 'typescript')
    expect(out).toContain('class="hljs-')
    expect(out).toContain('const')
    expect(out).toContain('1')
  })

  it('preserves HTML escaping — no literal <script> survives (XSS guard)', () => {
    const out = highlightDiffLine('<script>alert(1)</script>', 'typescript')
    expect(out).toContain('&lt;script&gt;')
    expect(out).not.toContain('<script>')
  })

  it('falls back to escaped plain text for unknown/empty languages without throwing', () => {
    expect(highlightDiffLine('<x> & "y"', undefined)).toBe('&lt;x&gt; &amp; &quot;y&quot;')
    expect(() => highlightDiffLine('whatever', 'notalang')).not.toThrow()
    expect(highlightDiffLine('<b>', 'notalang')).toBe('&lt;b&gt;')
  })
})
