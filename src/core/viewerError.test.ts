import { describe, it, expect } from 'vitest'
import { describeViewerReadError } from './viewerError'

const P = '/Users/me/wt/docs/plan.md'

describe('describeViewerReadError', () => {
  it('names the path for a missing file', () => {
    expect(describeViewerReadError({ code: 'ENOENT' }, P)).toBe(`File not found: ${P}`)
  })

  it('explains a directory', () => {
    expect(describeViewerReadError({ code: 'EISDIR' }, P)).toBe(
      `That path is a folder, not a file: ${P}`
    )
  })

  it('explains permission errors', () => {
    expect(describeViewerReadError({ code: 'EACCES' }, P)).toBe(`Permission denied reading ${P}`)
    expect(describeViewerReadError({ code: 'EPERM' }, P)).toBe(`Permission denied reading ${P}`)
  })

  it('explains an over-long path', () => {
    expect(describeViewerReadError({ code: 'ENAMETOOLONG' }, P)).toBe(`Path is too long: ${P}`)
  })

  it('falls back to the underlying message for unknown errors, still naming the path', () => {
    expect(describeViewerReadError(new Error('boom'), P)).toBe(`Could not read ${P} (boom)`)
  })

  it('handles non-Error throwables', () => {
    expect(describeViewerReadError('weird', P)).toBe(`Could not read ${P} (weird)`)
    expect(describeViewerReadError(null, P)).toBe(`Could not read ${P}`)
  })
})
