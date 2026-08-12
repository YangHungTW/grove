/**
 * Deciding WHICH pane an MCP tool call refers to, and whether writing into it
 * is safe right now. Pure, because these two decisions carry all the risk of
 * the send_to tool and must be testable without Electron:
 *
 *  - Resolution: every worktree's first agent is titled "claude", so a bare
 *    title is genuinely ambiguous across worktrees. Picking the first match
 *    would deliver a message to the wrong agent silently.
 *
 *  - The send guard: send_to types `message + Enter` into the target's pty.
 *    What that DOES depends entirely on what the pane is showing. An agent at
 *    its prompt reads it as a message (intended); but a pane sitting on a
 *    permission dialog reads the Enter as "confirm the selected option" — a
 *    remote agent approving another pane's pending permission — and a pane
 *    whose agent has not launched yet is a bare shell, where the text would
 *    EXECUTE as a command. Both must be refused, not queued.
 */

export interface PaneRef {
  id: string
  title: string
  /** Worktree path (used to disambiguate duplicate titles in errors). */
  worktree: string
  state: string
  waitingFor?: string
}

const short = (p: PaneRef): string => `"${p.title}" [id: ${p.id}] in ${p.worktree}`

/** Match a caller-supplied target to exactly one pane, by id or exact title. */
export function resolveTarget(
  target: string,
  panes: readonly PaneRef[]
): { pane: PaneRef } | { error: string } {
  const byId = panes.find((p) => p.id === target)
  if (byId) return { pane: byId }
  const byTitle = panes.filter((p) => p.title === target)
  if (byTitle.length === 1) return { pane: byTitle[0] }
  if (byTitle.length > 1)
    return {
      error:
        `Title "${target}" matches ${byTitle.length} panes: ` +
        byTitle.map(short).join('; ') +
        '. Address it by id instead.'
    }
  return { error: `No Grove pane matches "${target}". Call list_sessions first.` }
}

/**
 * Why a send into this pane must NOT happen right now, or null when it is safe.
 * Only `busy` and `idle` accept input as a message: busy queues it for the
 * agent's next turn, idle lands it at the agent's prompt and submits it.
 */
export function sendGuard(pane: PaneRef): string | null {
  switch (pane.state) {
    case 'busy':
    case 'idle':
      return null
    case 'waiting':
      return (
        `Not delivered: ${short(pane)} is waiting on the USER (${pane.waitingFor ?? 'input needed'}). ` +
        'Typing into it now would answer that prompt on the user\'s behalf. ' +
        'Retry once it is idle or busy, or surface what you need to the user instead.'
      )
    case 'starting':
      return (
        `Not delivered: ${short(pane)} is still starting — its agent has not launched, ` +
        'so input would run as a SHELL COMMAND in that worktree. Retry in a few seconds.'
      )
    default:
      return `Not delivered: ${short(pane)} is ${pane.state}.`
  }
}
