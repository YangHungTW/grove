/**
 * Token usage from Codex CLI rollout files (Electron-free).
 *
 * Codex writes one JSONL "rollout" per session under
 * `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<id>.jsonl`. Unlike Claude's
 * transcripts, the directory says nothing about the working directory, so the
 * cwd has to be read out of each file's `session_meta` line and matched against
 * the worktree.
 *
 * Three shapes matter, all of them `{type, timestamp, payload}` envelopes:
 *   session_meta  → payload.cwd, the session's working directory
 *   turn_context  → payload.model, the model in force for that turn
 *   event_msg     → payload.type === 'token_count', carrying the usage
 *
 * The usage event is CUMULATIVE: `info.total_token_usage` is the running total
 * for the whole session, re-reported after every turn. Summing the events would
 * multiply the session's tokens by the number of turns, so the last one wins.
 *
 * Written to be tolerant on purpose. Codex versions differ in whether, and
 * where, they persist token counts — the rollouts on the machine this was
 * written against carry messages but no usage at all. A file with no usage
 * contributes nothing and the worktree simply shows no Codex reading, which is
 * the honest outcome: never a fabricated zero.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { TranscriptUsage, WorktreeUsage } from './usageTypes'

/** Codex's session store. */
export function codexSessionsDir(home: string = homedir()): string {
  return join(home, '.codex', 'sessions')
}

interface CodexTokens {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
}

/** Pull a token block out of the several places Codex versions have put it. */
function tokensOf(payload: Record<string, unknown>, key: string): CodexTokens | undefined {
  const info = payload.info as Record<string, unknown> | undefined
  const fromInfo = info?.[key] as CodexTokens | undefined
  const direct = payload[key] as CodexTokens | undefined
  const found = fromInfo ?? direct
  return found && typeof found === 'object' ? found : undefined
}

/**
 * One rollout's usage, plus the cwd it ran in so the caller can match it to a
 * worktree. Returns null for a file that is not a usable rollout.
 *
 * `input_tokens` INCLUDES `cached_input_tokens` (Codex reports the prompt size
 * and then how much of it was cached), so the uncached remainder is the
 * difference — clamped at zero in case a version ever reports them separately.
 */
export function parseCodexRollout(jsonl: string): { cwd: string; usage: TranscriptUsage } | null {
  let cwd = ''
  let model = ''
  let lastTs = 0
  let total: CodexTokens | undefined
  let last: CodexTokens | undefined
  let sawUsage = false

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let e: { type?: string; timestamp?: string; payload?: Record<string, unknown> }
    try {
      e = JSON.parse(line)
    } catch {
      continue // tolerate a torn final line while Codex is mid-write
    }
    const payload = e.payload
    if (!payload || typeof payload !== 'object') continue
    const ts = e.timestamp ? Date.parse(e.timestamp) : 0
    if (Number.isFinite(ts) && ts > lastTs) lastTs = ts
    if (e.type === 'session_meta' && typeof payload.cwd === 'string') cwd = payload.cwd
    // The model can change mid-session; the latest turn's is the one to show.
    if (e.type === 'turn_context' && typeof payload.model === 'string') model = payload.model
    if (e.type === 'event_msg' && payload.type === 'token_count') {
      const t = tokensOf(payload, 'total_token_usage')
      const l = tokensOf(payload, 'last_token_usage')
      // Cumulative, not incremental — keep the newest, never add them up.
      if (t) {
        total = t
        sawUsage = true
      }
      if (l) last = l
    }
  }

  if (!cwd || !sawUsage || !total) return null
  const cached = total.cached_input_tokens ?? 0
  const prompt = total.input_tokens ?? 0
  const lastPrompt = last?.input_tokens ?? prompt
  return {
    cwd,
    usage: {
      input: Math.max(0, prompt - cached),
      output: total.output_tokens ?? 0,
      cacheRead: cached,
      // Codex bills no separate cache WRITE, so there is nothing to report here.
      cacheWrite: 0,
      // No price table for these models: tokens are known, dollars are not, and
      // sumUsage/mergeUsage treat null as "unpriced" rather than free.
      costUsd: null,
      model,
      contextTokens: lastPrompt,
      lastTs
    }
  }
}

/** Parse cache, so a 20s poll doesn't re-read rollouts that did not change. */
const fileCache = new Map<
  string,
  { mtimeMs: number; size: number; parsed: { cwd: string; usage: TranscriptUsage } | null }
>()

/** How far back to walk Codex's date-partitioned folders.
 *
 * The folder is named for the day the session STARTED, so a session opened last
 * week and still being appended to today lives under last week's date. Walking
 * every folder would mean stat-ing tens of thousands of files on a 20s poll, so
 * this bounds the search: a session older than this that is still live is not
 * worth that cost. Files are still filtered by mtime, so an old folder cannot
 * contribute stale numbers. */
const LOOKBACK_DAYS = 14

/** The `<YYYY>/<MM>/<DD>` folders worth opening for a window ending now. */
function recentDayDirs(root: string, sinceMs: number, days = LOOKBACK_DAYS): string[] {
  const out: string[] = []
  const day = new Date(sinceMs)
  day.setHours(0, 0, 0, 0)
  for (let i = 0; i < days; i++) {
    const d = new Date(day.getTime() - i * 86_400_000)
    out.push(
      join(
        root,
        String(d.getFullYear()),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0')
      )
    )
  }
  return out
}

/**
 * Aggregate Codex usage for sessions that ran in `worktreePath` and were
 * touched at/after `sinceMs`. Null when Codex has no such session — including
 * the common case where Codex is installed but records no token counts.
 */
export async function worktreeCodexUsage(
  worktreePath: string,
  sinceMs: number,
  home?: string
): Promise<WorktreeUsage | null> {
  const root = codexSessionsDir(home)
  const totals: WorktreeUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costUsd: null,
    model: '',
    contextTokens: 0,
    lastTs: 0,
    sessions: 0
  }

  for (const dir of recentDayDirs(root, Date.now())) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue // no sessions that day
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const path = join(dir, name)
      let s: { mtimeMs: number; size: number }
      try {
        s = await stat(path)
      } catch {
        continue
      }
      if (s.mtimeMs < sinceMs) continue
      let cached = fileCache.get(path)
      if (!cached || cached.mtimeMs !== s.mtimeMs || cached.size !== s.size) {
        let parsed: { cwd: string; usage: TranscriptUsage } | null = null
        try {
          parsed = parseCodexRollout(await readFile(path, 'utf8'))
        } catch {
          /* unreadable — skip */
        }
        cached = { mtimeMs: s.mtimeMs, size: s.size, parsed }
        fileCache.set(path, cached)
      }
      const p = cached.parsed
      if (!p || p.cwd !== worktreePath) continue
      const u = p.usage
      totals.sessions++
      totals.input += u.input
      totals.output += u.output
      totals.cacheRead += u.cacheRead
      totals.cacheWrite += u.cacheWrite
      if (u.costUsd != null) totals.costUsd = (totals.costUsd ?? 0) + u.costUsd
      if (u.lastTs >= totals.lastTs) {
        totals.lastTs = u.lastTs
        totals.model = u.model
        totals.contextTokens = u.contextTokens
      }
    }
  }
  return totals.sessions > 0 ? totals : null
}
