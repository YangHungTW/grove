import { describe, it, expect } from 'vitest'
import {
  MAX_WEBGL_RETRIES,
  WEBGL_RETRY_MS,
  canRetryWebgl,
  webglRetryDelay
} from './renderRetry.js'

describe('WebGL re-acquire retry policy', () => {
  it('allows exactly MAX_WEBGL_RETRIES probes, then stops', () => {
    expect(canRetryWebgl(0)).toBe(true)
    expect(canRetryWebgl(MAX_WEBGL_RETRIES - 1)).toBe(true)
    expect(canRetryWebgl(MAX_WEBGL_RETRIES)).toBe(false)
    // A pane that somehow over-counted must still stop, not loop forever.
    expect(canRetryWebgl(MAX_WEBGL_RETRIES + 10)).toBe(false)
  })

  it('backs off linearly from the base delay', () => {
    expect(webglRetryDelay(1)).toBe(WEBGL_RETRY_MS)
    expect(webglRetryDelay(3)).toBe(WEBGL_RETRY_MS * 3)
    expect(webglRetryDelay(MAX_WEBGL_RETRIES)).toBe(WEBGL_RETRY_MS * MAX_WEBGL_RETRIES)
  })

  it('never schedules a zero/negative delay (which would hot-loop the probe)', () => {
    for (const n of [0, -1, -100]) expect(webglRetryDelay(n)).toBe(WEBGL_RETRY_MS)
  })

  it('gives up within a bounded wall-clock window', () => {
    let total = 0
    for (let a = 1; a <= MAX_WEBGL_RETRIES; a++) total += webglRetryDelay(a)
    // Transient losses recover in seconds; probing must not drag on for minutes.
    expect(total).toBeLessThanOrEqual(30_000)
  })
})
