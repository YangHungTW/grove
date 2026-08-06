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
  resumeId?: string,
  extraFlags?: string
): { command: string; resumeId?: string } {
  // extraFlags are claude-specific (Grove's --mcp-config), so they ride the same
  // capability check as resume: handing them to another CLI would at best be
  // ignored and at worst abort the launch.
  if (!supportsResume(baseCommand)) return { command: baseCommand }
  // Applied per ALTERNATIVE rather than to the finished string: an initial task
  // prompt is appended later as a single-quoted argument, and a prompt
  // containing `||` would make any after-the-fact split corrupt it.
  //
  // Position matters. `--mcp-config` is VARIADIC — it keeps consuming arguments
  // until the next `-`-prefixed one — so it goes at the FRONT, where the
  // `--resume`/`--session-id` that follows terminates it. Appended at the end it
  // would instead swallow the task prompt and read it as a config filename.
  const cmd = extraFlags ? `${baseCommand} ${extraFlags}` : baseCommand
  if (resumeId) {
    // Resume the pinned session, but degrade gracefully so the tab never just
    // vanishes: if the session can't be resumed (it was never saved — an agent
    // opened but never used, a wiped/expired transcript), fall back to a fresh
    // session reusing the same id (resumable next time), then to a plain session.
    return {
      command: `${cmd} --resume ${resumeId} || ${cmd} --session-id ${resumeId} || ${cmd}`,
      resumeId
    }
  }
  const id = newId()
  return { command: `${cmd} --session-id ${id}`, resumeId: id }
}
