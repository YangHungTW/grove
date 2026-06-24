import { describe, it, expect } from 'vitest'
import { viewerMime } from './viewerMime'

describe('viewerMime', () => {
  it('serves HTML for .html/.htm so the viewer renders markup, not text', () => {
    expect(viewerMime('/x/report.html')).toBe('text/html; charset=utf-8')
    expect(viewerMime('/x/report.htm')).toBe('text/html; charset=utf-8')
  })

  it('recognises the assets a self-contained report references', () => {
    expect(viewerMime('a.css')).toBe('text/css; charset=utf-8')
    expect(viewerMime('a.js')).toBe('text/javascript; charset=utf-8')
    expect(viewerMime('a.svg')).toBe('image/svg+xml')
    expect(viewerMime('a.png')).toBe('image/png')
    expect(viewerMime('a.woff2')).toBe('font/woff2')
  })

  it('is case-insensitive on the extension', () => {
    expect(viewerMime('/X/REPORT.HTML')).toBe('text/html; charset=utf-8')
    expect(viewerMime('a.PNG')).toBe('image/png')
  })

  it('falls back to a binary stream for unknown or extensionless paths', () => {
    expect(viewerMime('/x/data.bin')).toBe('application/octet-stream')
    expect(viewerMime('/x/Makefile')).toBe('application/octet-stream')
    expect(viewerMime('')).toBe('application/octet-stream')
  })

  it('keys off the final extension, not earlier dots in the path', () => {
    expect(viewerMime('/x/my.report.v2.html')).toBe('text/html; charset=utf-8')
  })
})
