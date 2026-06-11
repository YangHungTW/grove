import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeProjectDir, parseTranscriptUsage, worktreeClaudeUsage } from './claudeUsage'

function assistantLine(opts: {
  id: string
  model?: string
  ts?: string
  usage?: Record<string, unknown>
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: opts.ts ?? '2026-06-11T10:00:00.000Z',
    message: {
      id: opts.id,
      model: opts.model ?? 'claude-sonnet-4-6',
      usage: opts.usage ?? {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 200
      }
    }
  })
}

describe('claudeProjectDir', () => {
  it('munges every non-alphanumeric path char to a dash', () => {
    expect(claudeProjectDir('/Users/me/.dot_file/x', '/home')).toBe(
      join('/home', '.claude', 'projects', '-Users-me--dot-file-x')
    )
  })
})

describe('parseTranscriptUsage', () => {
  it('sums usage across assistant messages', () => {
    const text = [assistantLine({ id: 'a' }), assistantLine({ id: 'b' })].join('\n')
    const u = parseTranscriptUsage(text)!
    expect(u.input).toBe(200)
    expect(u.output).toBe(100)
    expect(u.cacheRead).toBe(2000)
    expect(u.cacheWrite).toBe(400)
  })

  it('dedupes repeated usage lines from one API response (same message id)', () => {
    const text = [assistantLine({ id: 'a' }), assistantLine({ id: 'a' })].join('\n')
    const u = parseTranscriptUsage(text)!
    expect(u.input).toBe(100)
    expect(u.output).toBe(50)
  })

  it('reports the newest message model + context size and tolerates junk lines', () => {
    const text = [
      assistantLine({ id: 'a', ts: '2026-06-11T09:00:00.000Z', model: 'claude-sonnet-4-6' }),
      '{"type":"user","message":{}}',
      'not json {{{',
      assistantLine({
        id: 'b',
        ts: '2026-06-11T11:00:00.000Z',
        model: 'claude-opus-4-8',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 90_000,
          cache_creation_input_tokens: 500
        }
      })
    ].join('\n')
    const u = parseTranscriptUsage(text)!
    expect(u.model).toBe('claude-opus-4-8')
    expect(u.contextTokens).toBe(10 + 90_000 + 500)
  })

  it('estimates cost for known model families and leaves unknown ones null', () => {
    const sonnet = parseTranscriptUsage(
      assistantLine({
        id: 'a',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 1_000_000, output_tokens: 0 }
      })
    )!
    expect(sonnet.costUsd).toBeCloseTo(3, 5) // $3 / MTok input
    const unknown = parseTranscriptUsage(
      assistantLine({
        id: 'b',
        model: 'claude-fable-5',
        usage: { input_tokens: 1_000_000, output_tokens: 0 }
      })
    )!
    expect(unknown.costUsd).toBeNull()
    expect(unknown.input).toBe(1_000_000)
  })

  it('prices 1h cache writes at 2x and 5m at 1.25x input', () => {
    const u = parseTranscriptUsage(
      assistantLine({
        id: 'a',
        model: 'claude-sonnet-4-6',
        usage: {
          cache_creation_input_tokens: 2_000_000,
          cache_creation: {
            ephemeral_5m_input_tokens: 1_000_000,
            ephemeral_1h_input_tokens: 1_000_000
          }
        }
      })
    )!
    expect(u.costUsd).toBeCloseTo(3 * 1.25 + 3 * 2, 5)
  })

  it('returns null for a transcript with no assistant usage', () => {
    expect(parseTranscriptUsage('{"type":"user"}\n')).toBeNull()
    expect(parseTranscriptUsage('')).toBeNull()
  })
})

describe('worktreeClaudeUsage', () => {
  it('aggregates recent transcript files under the munged project dir', async () => {
    const home = mkdtempSync(join(tmpdir(), 'usage-home-'))
    const wt = '/tmp/my repo'
    const dir = claudeProjectDir(wt, home)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 's1.jsonl'), assistantLine({ id: 'a' }) + '\n')
    writeFileSync(join(dir, 's2.jsonl'), assistantLine({ id: 'b' }) + '\n')
    writeFileSync(join(dir, 'notes.txt'), 'ignored')

    const u = (await worktreeClaudeUsage(wt, 0, home))!
    expect(u.sessions).toBe(2)
    expect(u.input).toBe(200)

    // A since-cutoff in the future excludes everything → null.
    expect(await worktreeClaudeUsage(wt, Date.now() + 60_000, home)).toBeNull()
    // No transcript dir at all → null.
    expect(await worktreeClaudeUsage('/nope/never', 0, home)).toBeNull()
  })
})
