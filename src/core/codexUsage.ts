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

/** What the last scan learned about one rollout file. */
interface RolloutEntry {
  mtimeMs: number
  size: number
  /** When that stat was taken; see RESTAT_MS. */
  checkedAt: number
  /** Null for a file outside the window (never read) or not a usable rollout. */
  parsed: { cwd: string; usage: TranscriptUsage } | null
}

/** Per-file cache, so a scan doesn't re-stat or re-read rollouts that did not
 * change. Pruned to the files the latest scan saw, so a fortnight's rotation of
 * rollouts cannot grow it for the life of the process. */
const fileCache = new Map<string, RolloutEntry>()

/** How long a rollout already known to predate the window goes without a stat.
 *
 * Nearly every file under the lookback folders is from an earlier day, and the
 * window starts today: stat-ing all of them on every scan was the bulk of the
 * work for a result that never changes. A session that is resumed after lying
 * dormant past the window edge is caught on the next re-check. */
const RESTAT_MS = 5 * 60_000

/** How long one scan's result answers every worktree's lookup.
 *
 * The renderer polls every worktree in the same instant, and the scan is the
 * same for all of them — the cwd only matters at the very end. One scan per
 * tick is the point; the TTL just has to outlast the burst of lookups. */
const SCAN_TTL_MS = 5_000

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

/** Fold one session into its worktree's running total. */
function addSession(byCwd: Map<string, WorktreeUsage>, cwd: string, u: TranscriptUsage): void {
  let totals = byCwd.get(cwd)
  if (!totals) {
    totals = {
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
    byCwd.set(cwd, totals)
  }
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

/**
 * Walk the recent rollouts once and total them per cwd. Nothing here depends on
 * which worktree is asking, which is what lets one walk serve them all.
 */
async function scanRollouts(
  root: string,
  sinceMs: number,
  now: number
): Promise<Map<string, WorktreeUsage>> {
  const byCwd = new Map<string, WorktreeUsage>()
  const seen = new Set<string>()
  for (const dir of recentDayDirs(root, now)) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue // no sessions that day
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const path = join(dir, name)
      seen.add(path)
      let entry = fileCache.get(path)
      if (entry && entry.mtimeMs < sinceMs && now - entry.checkedAt < RESTAT_MS) continue
      let s: { mtimeMs: number; size: number }
      try {
        s = await stat(path)
      } catch {
        fileCache.delete(path)
        continue
      }
      if (!entry || entry.mtimeMs !== s.mtimeMs || entry.size !== s.size) {
        let parsed: { cwd: string; usage: TranscriptUsage } | null = null
        if (s.mtimeMs >= sinceMs) {
          try {
            parsed = parseCodexRollout(await readFile(path, 'utf8'))
          } catch {
            /* unreadable — skip */
          }
        }
        entry = { mtimeMs: s.mtimeMs, size: s.size, checkedAt: now, parsed }
        fileCache.set(path, entry)
      } else {
        entry.checkedAt = now
      }
      if (s.mtimeMs < sinceMs || !entry.parsed) continue
      addSession(byCwd, entry.parsed.cwd, entry.parsed.usage)
    }
  }
  for (const path of fileCache.keys()) if (!seen.has(path)) fileCache.delete(path)
  return byCwd
}

/** The scan in force: shared by every lookup inside SCAN_TTL_MS of its start,
 * whether it has finished yet or not — concurrent lookups await the same walk. */
let lastScan:
  | { root: string; sinceMs: number; at: number; byCwd: Promise<Map<string, WorktreeUsage>> }
  | undefined

/** Test hook: forget every scan and parsed file, as a fresh process would. */
export function resetCodexUsageCache(): void {
  lastScan = undefined
  fileCache.clear()
}

/** Test hook: how many rollout files the cache currently remembers. */
export function cachedRolloutCount(): number {
  return fileCache.size
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
  const now = Date.now()
  if (
    !lastScan ||
    lastScan.root !== root ||
    lastScan.sinceMs !== sinceMs ||
    now - lastScan.at >= SCAN_TTL_MS
  ) {
    lastScan = { root, sinceMs, at: now, byCwd: scanRollouts(root, sinceMs, now) }
  }
  return (await lastScan.byCwd).get(worktreePath) ?? null
}
