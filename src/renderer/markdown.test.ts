// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders a heading and strips dangerous handlers', () => {
    const out = renderMarkdown('# Hi\n\n<img src=x onerror=alert(1)>')
    expect(out).toContain('<h1>Hi</h1>')
    expect(out).not.toContain('onerror')
  })

  it('removes <script> tags but keeps ordinary formatting', () => {
    const out = renderMarkdown('Hello **world**\n\n<script>alert(1)</script>')
    expect(out).toContain('<strong>world</strong>')
    expect(out).not.toContain('<script>')
  })

  it('rewrites a relative image path to an absolute file:// URL under baseDir', () => {
    const out = renderMarkdown('![logo](assets/logo.svg)', '/home/me/proj')
    expect(out).toContain('file:///home/me/proj/assets/logo.svg')
  })

  it('encodes spaces in the baseDir of rewritten file:// image paths', () => {
    const out = renderMarkdown('![logo](assets/logo.png)', '/Users/me/My Projects/repo')
    expect(out).toContain('file:///Users/me/My%20Projects/repo/assets/logo.png')
    expect(out).not.toContain('My Projects/repo/assets')
  })

  it('leaves absolute image URLs untouched', () => {
    const out = renderMarkdown('![x](https://example.com/x.png)', '/home/me/proj')
    expect(out).toContain('https://example.com/x.png')
    expect(out).not.toContain('file://')
  })

  it('converts a ```mermaid fence into a <pre class="mermaid"> holder with the source', () => {
    const out = renderMarkdown('```mermaid\ngraph TD\n  A --> B\n```')
    expect(out).toContain('<pre class="mermaid">')
    expect(out).toContain('graph TD')
    expect(out).toContain('A --&gt; B') // source preserved as escaped text content
    expect(out).not.toContain('language-mermaid') // original code block replaced
  })

  it('leaves a non-mermaid code fence as a normal code block', () => {
    const out = renderMarkdown('```ts\nconst x = 1\n```')
    expect(out).toContain('<code')
    expect(out).not.toContain('class="mermaid"')
  })
})
