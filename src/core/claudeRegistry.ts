/**
 * Reading Claude Code's OWN session registry.
 *
 * Since 2.1, every `claude` process advertises itself in
 * `~/.claude/sessions/<pid>.json` and rewrites that file on each status
 * transition. The status is computed from the CLI's actual UI state — a pending
 * permission dialog, a sandbox request, an elicitation prompt — not by looking
 * at rendered text. That makes it strictly better than `stateDetection.ts`,
 * which infers the same thing by regex-matching the pty byte stream and
 * therefore breaks whenever the CLI restyles its output.
 *
 * Grove already pins `--session-id <uuid>` when it launches a claude-family
 * agent (see `buildAgentLaunch` in ./resume), and that uuid is exactly the
 * `sessionId` in this registry — so the two sides join without any new
 * bookkeeping on the agent's part.
 *
 * Electron-free and side-effect-free: the caller does the fs work (main watches
 * the directory) and hands raw parsed JSON in here. Liveness (is this pid still
 * running?) is likewise the caller's job — a crashed CLI can leave its file
 * behind, and only the caller can check.
 */
import type { SessionState } from './types'

/** The subset of Claude's per-session record Grove relies on. */
export interface RegistryEntry {
  pid: number
  /** The agent's own session uuid — Grove's join key (it pinned this value). */
  sessionId: string
  cwd: string
  /** `interactive` = attached to a terminal; `bg` = a `claude --bg` job. */
  kind: 'interactive' | 'bg'
  /** Display name (`--name`, or derived from the directory). */
  name?: string
  status: RegistryStatus
  /** Why it is waiting, e.g. "dialog open" / "sandbox request" / "input needed".
   * Only present while `status === 'waiting'`. */
  waitingFor?: string
  /** Short id for `claude attach|logs|stop <id>`. Background sessions only. */
  jobId?: string
  startedAt?: number
  updatedAt?: number
}

/** The three states Claude reports. Deliberately a 1:1 subset of SessionState. */
export type RegistryStatus = 'busy' | 'idle' | 'waiting'

const STATUSES: readonly string[] = ['busy', 'idle', 'waiting']

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Validate one parsed `<pid>.json`. Returns null for anything unusable rather
 * than throwing: the directory is written by another program at arbitrary
 * times, so a half-written or newer-schema file is an ordinary occurrence, not
 * an error worth surfacing. Mirrors the tolerant parsing in ClosedAgentsStore.
 */
export function parseRegistryEntry(raw: unknown): RegistryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const pid = num(o.pid)
  const sessionId = str(o.sessionId)
  const cwd = str(o.cwd)
  const status = str(o.status)
  if (pid === undefined || !sessionId || !cwd || !status || !STATUSES.includes(status)) return null
  // `--json` reports this as "background" while the file on disk says "bg";
  // accept both so we key off one spelling everywhere downstream.
  const rawKind = str(o.kind)
  const kind: RegistryEntry['kind'] = rawKind === 'bg' || rawKind === 'background' ? 'bg' : 'interactive'
  return {
    pid,
    sessionId,
    cwd,
    kind,
    name: str(o.name),
    status: status as RegistryStatus,
    // Only meaningful while waiting; drop it otherwise so a stale reason can't
    // linger in the UI after the dialog closed.
    waitingFor: status === 'waiting' ? str(o.waitingFor) : undefined,
    jobId: str(o.jobId),
    startedAt: num(o.startedAt),
    updatedAt: num(o.updatedAt)
  }
}

/**
 * Map to Grove's lifecycle state. The registry only ever speaks about a running
 * process, so `starting` and `exited` stay pty-driven and are never produced
 * here — the caller keeps owning both ends of the lifecycle.
 */
export function toSessionState(entry: RegistryEntry): Extract<SessionState, RegistryStatus> {
  return entry.status
}

/** What a Grove session currently shows, as far as the registry is concerned. */
export interface JoinedState {
  state: SessionState
  waitingFor?: string
}

/** A change the registry wants applied to one Grove session. */
export interface RegistryUpdate {
  groveId: string
  state: Extract<SessionState, RegistryStatus>
  waitingFor?: string
  /** True when only the reason moved (one dialog replaced another). The caller
   * must still emit: a state-setter that early-returns on an unchanged state
   * would swallow the new reason. */
  reasonOnly: boolean
}

/**
 * Diff Claude's registry against what Grove is currently showing, and return
 * only the sessions that actually need updating.
 *
 * Kept here rather than in the main process so the decision — which is all the
 * subtlety there is — can be tested without an Electron app or a filesystem.
 * The caller supplies the join (`agentSessionIds`) and the current view, and
 * owns everything this deliberately does not touch: sessions with no live
 * registry record (they keep falling back to stateDetection) and sessions the
 * pty has already marked `exited` (a registry file can outlive its process, and
 * must never resurrect a torn-down tab).
 */
export function registryUpdates(
  entries: readonly RegistryEntry[],
  agentSessionIds: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, JoinedState>
): RegistryUpdate[] {
  const byUuid = new Map(entries.map((e) => [e.sessionId, e]))
  const out: RegistryUpdate[] = []
  for (const [groveId, uuid] of agentSessionIds) {
    const entry = byUuid.get(uuid)
    const now = current.get(groveId)
    if (!entry || !now || now.state === 'exited') continue
    const state = toSessionState(entry)
    const waitingFor = entry.waitingFor
    const stateChanged = state !== now.state
    const reasonChanged = waitingFor !== now.waitingFor
    if (!stateChanged && !reasonChanged) continue
    out.push({ groveId, state, waitingFor, reasonOnly: !stateChanged })
  }
  return out
}

/**
 * Registry entries that are NOT one of Grove's own panes — sessions started in
 * a plain terminal, or `claude --bg` jobs. This is what the sidebar's
 * "Elsewhere" section lists: agents running on this machine that Grove would
 * otherwise leave invisible.
 */
export function unjoinedEntries(
  entries: readonly RegistryEntry[],
  joinedSessionIds: ReadonlySet<string>
): RegistryEntry[] {
  return entries.filter((e) => !joinedSessionIds.has(e.sessionId))
}
