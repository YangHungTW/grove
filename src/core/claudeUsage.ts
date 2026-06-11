/**
 * Token/cost aggregation from Claude Code transcripts (Electron-free).
 *
 * Claude Code writes one JSONL transcript per session under
 * `~/.claude/projects/<munged-cwd>/<session-id>.jsonl`, where the munged cwd is
 * the absolute path with every non-alphanumeric character replaced by `-`.
 * Each `assistant` line carries the API `usage` block for the request that
 * produced it, so summing usage across lines gives the session's billed
 * tokens. One API response is split into multiple JSONL lines (one per content
 * block) that REPEAT the same usage — dedupe by `message.id` before summing.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface TranscriptUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Estimated USD cost over messages with a known price (null if none had one). */
  costUsd: number | null
  /** Model of the newest assistant message. */
  model: string
  /** Newest message's full prompt size — the conversation's current context. */
  contextTokens: number
  /** Timestamp (ms) of the newest assistant message. */
  lastTs: number
}

export interface WorktreeUsage extends TranscriptUsage {
  /** Number of transcript files (sessions) aggregated. */
  sessions: number
}

/** Per-MTok USD prices. Matched by family substring; unknown models contribute
 * tokens but no cost (costUsd stays null if nothing matched). */
const PRICES: { match: RegExp; input: number; output: number; cacheRead: number }[] = [
  { match: /opus/, input: 15, output: 75, cacheRead: 1.5 },
  { match: /sonnet/, input: 3, output: 15, cacheRead: 0.3 },
  { match: /haiku/, input: 1, output: 5, cacheRead: 0.1 }
]

/** The transcript folder Claude Code uses for sessions launched in `cwd`. */
export function claudeProjectDir(cwd: string, home: string = homedir()): string {
  return join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
}

interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

function costOf(model: string, u: RawUsage): number | null {
  const p = PRICES.find((x) => x.match.test(model))
  if (!p) return null
  const w5 = u.cache_creation?.ephemeral_5m_input_tokens
  const w1 = u.cache_creation?.ephemeral_1h_input_tokens
  // Cache writes: 5-minute TTL bills 1.25x input, 1-hour TTL 2x. Without the
  // breakdown, assume the whole cache_creation count was the (default) 5m TTL.
  const writeCost =
    w5 != null || w1 != null
      ? ((w5 ?? 0) * 1.25 + (w1 ?? 0) * 2) * p.input
      : (u.cache_creation_input_tokens ?? 0) * 1.25 * p.input
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      writeCost) /
    1_000_000
  )
}

/** Sum a transcript's assistant-message usage (deduped by message id). */
export function parseTranscriptUsage(jsonl: string): TranscriptUsage | null {
  const seen = new Set<string>()
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  let costUsd: number | null = null
  let model = ''
  let contextTokens = 0
  let lastTs = 0

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let entry: {
      type?: string
      timestamp?: string
      message?: { id?: string; model?: string; usage?: RawUsage }
    }
    try {
      entry = JSON.parse(line)
    } catch {
      continue // tolerate a torn final line while Claude is mid-write
    }
    if (entry.type !== 'assistant') continue
    const u = entry.message?.usage
    if (!u) continue
    const id = entry.message?.id
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    input += u.input_tokens ?? 0
    output += u.output_tokens ?? 0
    cacheRead += u.cache_read_input_tokens ?? 0
    cacheWrite += u.cache_creation_input_tokens ?? 0
    const m = entry.message?.model ?? ''
    const c = costOf(m, u)
    if (c != null) costUsd = (costUsd ?? 0) + c
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : 0
    if (ts >= lastTs) {
      lastTs = ts
      if (m) model = m
      contextTokens =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0)
    }
  }
  if (seen.size === 0 && input + output + cacheRead + cacheWrite === 0) return null
  return { input, output, cacheRead, cacheWrite, costUsd, model, contextTokens, lastTs }
}

// Parse cache so a 30s poll doesn't re-read multi-MB transcripts that didn't
// change. Keyed by file path; invalidated by mtime+size.
const fileCache = new Map<
  string,
  { mtimeMs: number; size: number; parsed: TranscriptUsage | null }
>()

/**
 * Aggregate Claude usage for sessions launched in `worktreePath` whose
 * transcript was touched at/after `sinceMs` (e.g. start of today).
 * Returns null when there is no transcript dir or no recent session.
 */
export async function worktreeClaudeUsage(
  worktreePath: string,
  sinceMs: number,
  home?: string
): Promise<WorktreeUsage | null> {
  const dir = claudeProjectDir(worktreePath, home)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return null // no Claude sessions for this path
  }
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
      let parsed: TranscriptUsage | null = null
      try {
        parsed = parseTranscriptUsage(await readFile(path, 'utf8'))
      } catch {
        /* unreadable — skip */
      }
      cached = { mtimeMs: s.mtimeMs, size: s.size, parsed }
      fileCache.set(path, cached)
    }
    const p = cached.parsed
    if (!p) continue
    totals.sessions++
    totals.input += p.input
    totals.output += p.output
    totals.cacheRead += p.cacheRead
    totals.cacheWrite += p.cacheWrite
    if (p.costUsd != null) totals.costUsd = (totals.costUsd ?? 0) + p.costUsd
    if (p.lastTs >= totals.lastTs) {
      totals.lastTs = p.lastTs
      totals.model = p.model
      totals.contextTokens = p.contextTokens
    }
  }
  return totals.sessions > 0 ? totals : null
}
