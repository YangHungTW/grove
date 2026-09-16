/** The shape every agent's usage provider reports in (see agentUsage.ts). */

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
