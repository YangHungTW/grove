import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cachedTranscriptCount,
  claudeProjectDir,
  parseTranscriptUsage,
  resetClaudeUsageCache,
  worktreeClaudeUsage
} from './claudeUsage'

// Record which files a poll stats: the fix under test is about how much work a
// poll does, which the totals alone cannot show.
const statCalls = vi.hoisted(() => ({ paths: [] as string[] }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    stat: ((path: Parameters<typeof real.stat>[0], opts?: never) => {
      statCalls.paths.push(String(path))
      return real.stat(path, opts)
    }) as typeof real.stat
  }
})

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
  beforeEach(() => {
    resetClaudeUsageCache()
    statCalls.paths = []
    // Only Date is faked: the re-stat interval is decided on Date.now(), and
    // the fs calls must stay real.
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => vi.useRealTimers())

  it('does not re-stat a transcript already known to predate the window', async () => {
    // A project dir holds every session ever run there; the window is today.
    const home = mkdtempSync(join(tmpdir(), 'usage-home-'))
    const wt = '/tmp/repo'
    const dir = claudeProjectDir(wt, home)
    mkdirSync(dir, { recursive: true })
    const since = Date.now() - 60_000
    const old = join(dir, 'old.jsonl')
    writeFileSync(old, assistantLine({ id: 'a' }) + '\n')
    utimesSync(old, new Date(since - 3_600_000), new Date(since - 3_600_000))
    const fresh = join(dir, 'fresh.jsonl')
    writeFileSync(fresh, assistantLine({ id: 'b' }) + '\n')

    expect((await worktreeClaudeUsage(wt, since, home))?.sessions).toBe(1)
    expect(statCalls.paths).toHaveLength(2)

    // Next poll: only the in-window file is worth a stat.
    vi.advanceTimersByTime(30_000)
    statCalls.paths = []
    expect((await worktreeClaudeUsage(wt, since, home))?.sessions).toBe(1)
    expect(statCalls.paths).toEqual([fresh])

    // The trade-off: a dormant session that wakes up is noticed on the next
    // re-check, not the next poll.
    writeFileSync(old, assistantLine({ id: 'a' }) + '\n')
    vi.advanceTimersByTime(30_000)
    expect((await worktreeClaudeUsage(wt, since, home))?.sessions).toBe(1)
    vi.advanceTimersByTime(5 * 60_000)
    expect((await worktreeClaudeUsage(wt, since, home))?.sessions).toBe(2)
  })

  it('forgets transcripts the listing no longer shows, so the cache stays bounded', async () => {
    const home = mkdtempSync(join(tmpdir(), 'usage-home-'))
    const wt = '/tmp/repo'
    const dir = claudeProjectDir(wt, home)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.jsonl'), assistantLine({ id: 'a' }) + '\n')
    writeFileSync(join(dir, 'b.jsonl'), assistantLine({ id: 'b' }) + '\n')
    expect((await worktreeClaudeUsage(wt, 0, home))?.sessions).toBe(2)
    expect(cachedTranscriptCount()).toBe(2)

    rmSync(join(dir, 'b.jsonl'))
    expect((await worktreeClaudeUsage(wt, 0, home))?.sessions).toBe(1)
    expect(cachedTranscriptCount()).toBe(1)

    // A project dir that disappears takes its entries with it.
    rmSync(dir, { recursive: true })
    expect(await worktreeClaudeUsage(wt, 0, home)).toBeNull()
    expect(cachedTranscriptCount()).toBe(0)
  })

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
