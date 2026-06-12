import { describe, expect, it } from 'vitest'
import { shellQuote } from './shellQuote'

describe('shellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellQuote('/path/to/file.txt')).toBe(`'/path/to/file.txt'`)
  })

  it('neutralises embedded single quotes (close, escape, reopen)', () => {
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`)
  })

  it('leaves shell metacharacters inert inside the quotes', () => {
    expect(shellQuote('a; rm -rf ~ $(x) `y` |z')).toBe(`'a; rm -rf ~ $(x) \`y\` |z'`)
  })
})
