import { describe, it, expect } from 'vitest'
import { isHttpUrl, parseFrameability } from './openTarget'

describe('isHttpUrl', () => {
  it('matches http and https (any case), trimming', () => {
    expect(isHttpUrl('https://example.com')).toBe(true)
    expect(isHttpUrl('http://localhost:3000/x')).toBe(true)
    expect(isHttpUrl('  HTTPS://EXAMPLE.com  ')).toBe(true)
  })
  it('rejects non-http inputs (paths, file://, bare hosts)', () => {
    expect(isHttpUrl('/path/to/x.md')).toBe(false)
    expect(isHttpUrl('docs/x.md')).toBe(false)
    expect(isHttpUrl('file:///x.html')).toBe(false)
    expect(isHttpUrl('example.com')).toBe(false)
  })
})

describe('parseFrameability', () => {
  it('is embeddable when no blocking headers', () => {
    expect(parseFrameability(null, null)).toBe(true)
    expect(parseFrameability(null, "default-src 'self'")).toBe(true)
  })
  it('blocks on X-Frame-Options DENY/SAMEORIGIN/ALLOW-FROM', () => {
    expect(parseFrameability('DENY', null)).toBe(false)
    expect(parseFrameability('SameOrigin', null)).toBe(false)
    expect(parseFrameability('ALLOW-FROM https://x.com', null)).toBe(false)
  })
  it('blocks on restrictive CSP frame-ancestors', () => {
    expect(parseFrameability(null, "frame-ancestors 'none'")).toBe(false)
    expect(parseFrameability(null, "frame-ancestors 'self'")).toBe(false)
    expect(parseFrameability(null, "default-src 'self'; frame-ancestors https://trusted.com")).toBe(
      false
    )
  })
  it('allows a wildcard frame-ancestors', () => {
    expect(parseFrameability(null, 'frame-ancestors *')).toBe(true)
  })
})
