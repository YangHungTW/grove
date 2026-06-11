import { describe, expect, it } from 'vitest'
import { parsePrView, summarizeChecks } from './gh'

describe('summarizeChecks', () => {
  it('returns none for an empty rollup', () => {
    expect(summarizeChecks([])).toBe('none')
    expect(summarizeChecks(null)).toBe('none')
  })

  it('passes when every CheckRun completed successfully (or was skipped)', () => {
    expect(
      summarizeChecks([
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'NEUTRAL' }
      ])
    ).toBe('pass')
  })

  it('fails on any failed run, even with others pending', () => {
    expect(
      summarizeChecks([
        { __typename: 'CheckRun', status: 'IN_PROGRESS' },
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }
      ])
    ).toBe('fail')
  })

  it('is pending while any run is still going', () => {
    expect(
      summarizeChecks([
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', status: 'QUEUED' }
      ])
    ).toBe('pending')
  })

  it('understands StatusContext entries (state instead of status/conclusion)', () => {
    expect(summarizeChecks([{ __typename: 'StatusContext', state: 'SUCCESS' }])).toBe('pass')
    expect(summarizeChecks([{ __typename: 'StatusContext', state: 'PENDING' }])).toBe('pending')
    expect(summarizeChecks([{ __typename: 'StatusContext', state: 'ERROR' }])).toBe('fail')
  })
})

describe('parsePrView', () => {
  it('shapes a gh pr view payload', () => {
    const pr = parsePrView({
      number: 12,
      url: 'https://github.com/o/r/pull/12',
      state: 'OPEN',
      reviewDecision: 'APPROVED',
      statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }]
    })!
    expect(pr.number).toBe(12)
    expect(pr.state).toBe('OPEN')
    expect(pr.checks).toBe('pass')
    expect(pr.reviewDecision).toBe('APPROVED')
  })

  it('rejects malformed payloads', () => {
    expect(parsePrView(null)).toBeNull()
    expect(parsePrView({})).toBeNull()
    expect(parsePrView({ number: 'x', url: 'u' })).toBeNull()
  })
})
