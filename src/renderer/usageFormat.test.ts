import { describe, expect, it } from 'vitest'
import { formatTokens, formatUsd, shortModel } from './usageFormat'

describe('formatTokens', () => {
  it('keeps small counts literal and abbreviates k/M', () => {
    expect(formatTokens(812)).toBe('812')
    expect(formatTokens(4_530)).toBe('4.5k')
    expect(formatTokens(45_300)).toBe('45k')
    expect(formatTokens(1_240_000)).toBe('1.2M')
  })
})

describe('formatUsd', () => {
  it('shows cents and floors tiny amounts', () => {
    expect(formatUsd(1.234)).toBe('$1.23')
    expect(formatUsd(0.05)).toBe('$0.05')
    expect(formatUsd(0.001)).toBe('<$0.01')
  })
})

describe('shortModel', () => {
  it('shortens known families with versions', () => {
    expect(shortModel('claude-opus-4-8')).toBe('opus 4.8')
    expect(shortModel('claude-sonnet-4-6')).toBe('sonnet 4.6')
    expect(shortModel('claude-fable-5')).toBe('fable 5')
  })
  it('drops trailing date stamps', () => {
    expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
  })
  it('passes unknown ids through without the claude- prefix', () => {
    expect(shortModel('claude-next-thing')).toBe('next-thing')
  })
})
