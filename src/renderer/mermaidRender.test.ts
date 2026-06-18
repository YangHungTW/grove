import { describe, it, expect } from 'vitest'
import { isDarkBg } from './mermaidRender'

describe('isDarkBg', () => {
  it('detects dark backgrounds', () => {
    expect(isDarkBg('#282828')).toBe(true) // Grove's default
    expect(isDarkBg('#000000')).toBe(true)
    expect(isDarkBg('000000')).toBe(true) // tolerates a missing leading #
  })

  it('detects light backgrounds', () => {
    expect(isDarkBg('#ffffff')).toBe(false)
    expect(isDarkBg('#ebdbb2')).toBe(false)
  })

  it('defaults to dark for unparseable input', () => {
    expect(isDarkBg('rgb(0,0,0)')).toBe(true)
    expect(isDarkBg('')).toBe(true)
  })
})
