import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexSessionsDir, parseCodexRollout, worktreeCodexUsage } from './codexUsage'

const meta = (cwd: string): string =>
  JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-09-10T09:00:00.000Z',
    payload: { cwd, id: 'abc', cli_version: '0.50.0' }
  })

const turn = (model: string): string =>
  JSON.stringify({
    type: 'turn_context',
    timestamp: '2026-09-10T09:00:01.000Z',
    payload: { cwd: '/x', model, approval_policy: 'never' }
  })

const tokenCount = (
  ts: string,
  total: { input_tokens: number; cached_input_tokens?: number; output_tokens: number },
  last?: { input_tokens: number; output_tokens: number }
): string =>
  JSON.stringify({
    type: 'event_msg',
    timestamp: ts,
    payload: {
      type: 'token_count',
      info: { total_token_usage: total, last_token_usage: last, model_context_window: 272_000 }
    }
  })

describe('parseCodexRollout', () => {
  it('reads cwd, model and usage out of a rollout', () => {
    const r = parseCodexRollout(
      [
        meta('/repo/wt'),
        turn('gpt-5.1-codex'),
        tokenCount('2026-09-10T09:00:05.000Z', {
          input_tokens: 10_000,
          cached_input_tokens: 8_000,
          output_tokens: 500
        })
      ].join('\n')
    )
    expect(r?.cwd).toBe('/repo/wt')
    expect(r?.usage.model).toBe('gpt-5.1-codex')
    // input_tokens INCLUDES the cached part, so uncached is the remainder.
    expect(r?.usage.input).toBe(2_000)
    expect(r?.usage.cacheRead).toBe(8_000)
    expect(r?.usage.output).toBe(500)
    // Codex bills no separate cache write.
    expect(r?.usage.cacheWrite).toBe(0)
  })

  it('takes the LAST usage event, never the sum — the counts are cumulative', () => {
    // Codex re-reports the running session total after every turn. Adding the
    // events together would multiply the session by its number of turns.
    const r = parseCodexRollout(
      [
        meta('/repo/wt'),
        turn('gpt-5.1-codex'),
        tokenCount('2026-09-10T09:00:05.000Z', { input_tokens: 1_000, output_tokens: 100 }),
        tokenCount('2026-09-10T09:01:05.000Z', { input_tokens: 3_000, output_tokens: 400 })
      ].join('\n')
    )
    expect(r?.usage.input).toBe(3_000)
    expect(r?.usage.output).toBe(400)
  })

  it('takes context from the last turn, not the session total', () => {
    const r = parseCodexRollout(
      [
        meta('/repo/wt'),
        tokenCount(
          '2026-09-10T09:01:05.000Z',
          { input_tokens: 90_000, output_tokens: 900 },
          { input_tokens: 42_000, output_tokens: 300 }
        )
      ].join('\n')
    )
    expect(r?.usage.contextTokens).toBe(42_000)
  })

  it('leaves cost unpriced rather than free — there is no price table for these', () => {
    const r = parseCodexRollout(
      [meta('/repo/wt'), tokenCount('2026-09-10T09:00:05.000Z', { input_tokens: 1, output_tokens: 1 })].join('\n')
    )
    expect(r?.usage.costUsd).toBeNull()
  })

  it('accepts a usage block reported without the info wrapper', () => {
    // Codex versions differ on nesting; both shapes must land.
    const line = JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-09-10T09:00:05.000Z',
      payload: { type: 'token_count', total_token_usage: { input_tokens: 7, output_tokens: 3 } }
    })
    const r = parseCodexRollout([meta('/repo/wt'), line].join('\n'))
    expect(r?.usage.input).toBe(7)
  })

  it('reports NOTHING for a rollout that carries no token counts', () => {
    // This is the common case on a real machine: the rollout holds the messages
    // and no usage at all. It must contribute nothing, not a zero reading.
    const r = parseCodexRollout(
      [
        meta('/repo/wt'),
        turn('gpt-5.1-codex'),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-09-10T09:00:02.000Z',
          payload: { type: 'message', role: 'assistant' }
        })
      ].join('\n')
    )
    expect(r).toBeNull()
  })

  it('survives a torn last line and a rollout with no session_meta', () => {
    expect(parseCodexRollout('{"type":"event_msg",{{{')).toBeNull()
    expect(
      parseCodexRollout(tokenCount('2026-09-10T09:00:05.000Z', { input_tokens: 5, output_tokens: 5 }))
    ).toBeNull()
  })
})

describe('worktreeCodexUsage', () => {
  const seed = (home: string, day: Date, name: string, lines: string[]): void => {
    const dir = join(
      codexSessionsDir(home),
      String(day.getFullYear()),
      String(day.getMonth() + 1).padStart(2, '0'),
      String(day.getDate()).padStart(2, '0')
    )
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), lines.join('\n') + '\n')
  }

  it('sums only the sessions whose cwd is this worktree', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'))
    const today = new Date()
    seed(home, today, 'rollout-a.jsonl', [
      meta('/repo/wt'),
      turn('gpt-5.1-codex'),
      tokenCount('2026-09-10T09:00:05.000Z', { input_tokens: 1_000, output_tokens: 100 })
    ])
    seed(home, today, 'rollout-b.jsonl', [
      meta('/somewhere/else'),
      turn('gpt-5.1-codex'),
      tokenCount('2026-09-10T09:00:05.000Z', { input_tokens: 9_999, output_tokens: 9_999 })
    ])
    const u = await worktreeCodexUsage('/repo/wt', 0, home)
    expect(u?.sessions).toBe(1)
    expect(u?.input).toBe(1_000)
    expect(u?.output).toBe(100)
  })

  it('is null when Codex has recorded nothing for this worktree', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'))
    expect(await worktreeCodexUsage('/repo/wt', 0, home)).toBeNull()
  })

  it('is null when Codex is not installed at all', async () => {
    expect(await worktreeCodexUsage('/repo/wt', 0, '/nonexistent-home')).toBeNull()
  })
})
