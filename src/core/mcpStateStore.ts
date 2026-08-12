import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Persistent MCP server state, for durable-agent continuity across a Grove
 * restart.
 *
 * A durable (tmux) agent outlives Grove, and its claude process read its
 * `--mcp-config` — port + bearer ticket — exactly once, at launch. Requests are
 * made fresh per tool call though, so a reattached agent's tools keep working
 * across a restart IF the new Grove binds the SAME port and accepts the SAME
 * ticket. That pair is what this store remembers:
 *
 *  - `port`: preferred bind; the server falls back to an ephemeral port when
 *    it's taken (old agents' tools then break — unavoidable — and the new port
 *    is saved).
 *  - `durable`: ticket per durableKey (the same stable id that names the tmux
 *    session), re-registered with the server at boot so a process launched by a
 *    previous Grove still authenticates.
 *
 * Tickets grant "type into this user's terminals", so the file must be 0600 —
 * the same posture as the per-agent config files. Pure Node (no Electron) for
 * unit-testability, mirroring ClosedAgentsStore.
 */
export interface McpState {
  port?: number
  /** durableKey → bearer ticket. */
  durable: Record<string, string>
}

const EMPTY: McpState = { durable: {} }

export class McpStateStore {
  constructor(private readonly file: string) {}

  load(): McpState {
    if (!existsSync(this.file)) return { ...EMPTY, durable: {} }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>
      const durable: Record<string, string> = {}
      if (typeof raw?.durable === 'object' && raw.durable !== null)
        for (const [k, v] of Object.entries(raw.durable))
          if (typeof v === 'string' && v) durable[k] = v
      const port =
        typeof raw?.port === 'number' && Number.isInteger(raw.port) && raw.port > 0
          ? raw.port
          : undefined
      return { port, durable }
    } catch {
      return { ...EMPTY, durable: {} }
    }
  }

  save(state: McpState): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(state, null, 2), { mode: 0o600 })
  }
}

/**
 * Drop persisted tickets whose durableKey nothing references any more. The
 * layout (open panes) and the recently-closed list are the only two ways a
 * durable agent can ever be reattached — a ticket for any other key is a live
 * credential with no owner, kept alive for nothing.
 */
export function pruneDurable(state: McpState, referenced: ReadonlySet<string>): McpState {
  const durable: Record<string, string> = {}
  for (const [k, v] of Object.entries(state.durable)) if (referenced.has(k)) durable[k] = v
  return { ...state, durable }
}
