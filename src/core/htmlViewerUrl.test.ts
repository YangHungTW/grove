import { describe, it, expect } from 'vitest'
import { HTML_VIEWER_SCHEME, htmlViewerSrc, htmlViewerPath } from './htmlViewerUrl'

describe('htmlViewerUrl', () => {
  it('builds a grove-html URL whose pathname is the absolute file path', () => {
    expect(htmlViewerSrc('/Users/me/report.html')).toBe(
      'grove-html://open/Users/me/report.html'
    )
  })

  it('round-trips paths with spaces, # and ? back to the original', () => {
    for (const p of [
      '/Users/me/report.html',
      '/Users/me/my report (final).html',
      '/tmp/a#b?c/page.html',
      '/Users/me/世界/报告.html'
    ]) {
      expect(htmlViewerPath(htmlViewerSrc(p))).toBe(p)
    }
  })

  it('keeps path separators as real slashes (relative assets can resolve)', () => {
    const url = htmlViewerSrc('/a/b/c.html')
    expect(new URL(url).pathname).toBe('/a/b/c.html')
    expect(url.startsWith(`${HTML_VIEWER_SCHEME}://`)).toBe(true)
  })

  it('encodes a space so the raw URL has no literal space', () => {
    expect(htmlViewerSrc('/a/b c.html')).toBe('grove-html://open/a/b%20c.html')
  })
})
