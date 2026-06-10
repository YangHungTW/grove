/** Resume support for coding agents. Pure (no Node/DOM) so it's unit-testable
 * and shared between the renderer (launch) and any future main-side use.
 *
 * Only the claude CLI is supported today: it accepts `--session-id <uuid>` to
 * pin a session id at launch and `--resume <uuid>` to reopen it. Grove pins the
 * id itself (claude does not print it) so it always knows the resume id. */

/** Does this agent command's CLI support `--session-id` / `--resume`? */
export function supportsResume(command: string): boolean {
  return command.trim().split(/\s+/)[0] === 'claude'
}

/**
 * Build the agent launch command and the resume id Grove will track.
 *  - new session  → append `--session-id <newId()>` (Grove owns the id)
 *  - resume       → append `--resume <resumeId>` (reopen that exact session)
 * For agents without resume support the base command is returned unchanged and
 * `resumeId` is undefined (nothing to track).
 *
 * `newId` is injected (not called internally) so callers supply the platform's
 * UUID source — `crypto.randomUUID` in the renderer — and tests stay deterministic.
 */
export function buildAgentLaunch(
  baseCommand: string,
  newId: () => string,
  resumeId?: string
): { command: string; resumeId?: string } {
  if (!supportsResume(baseCommand)) return { command: baseCommand }
  if (resumeId) return { command: `${baseCommand} --resume ${resumeId}`, resumeId }
  const id = newId()
  return { command: `${baseCommand} --session-id ${id}`, resumeId: id }
}
