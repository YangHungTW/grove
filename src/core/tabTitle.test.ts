import { describe, expect, it } from 'vitest'
import { autoTabTitle, MAX_AUTO_TITLE } from './tabTitle'

describe('autoTabTitle', () => {
  it("drops Claude's status glyph and keeps the conversation title", () => {
    expect(autoTabTitle('✳ Fix renderer leaks')).toBe('Fix renderer leaks')
  })

  it('treats every spinner frame as the same title', () => {
    const frames = ['◐', '◓', '◑', '◒'].map((g) => autoTabTitle(`${g} Draft release notes`))
    expect(new Set(frames)).toEqual(new Set(['Draft release notes']))
  })

  it("returns null for the agent's own name, so the tab keeps its default", () => {
    expect(autoTabTitle('✳ Claude Code')).toBeNull()
    expect(autoTabTitle('claude')).toBeNull()
    expect(autoTabTitle('   ')).toBeNull()
    expect(autoTabTitle('✳')).toBeNull()
  })

  it('keeps titles that start with a digit or a non-Latin letter', () => {
    expect(autoTabTitle('✳ 修正 renderer 洩漏')).toBe('修正 renderer 洩漏')
    expect(autoTabTitle('◐ 0.14.0 release')).toBe('0.14.0 release')
  })

  it('collapses whitespace and caps the length with an ellipsis', () => {
    expect(autoTabTitle('  a   b\tc ')).toBe('a b c')
    const long = 'x'.repeat(MAX_AUTO_TITLE + 20)
    const t = autoTabTitle(long)!
    expect(t.length).toBe(MAX_AUTO_TITLE)
    expect(t.endsWith('…')).toBe(true)
  })
})
