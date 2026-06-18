/** How to treat a pty's exit. Pure (no Node/DOM) so the renderer can decide
 * whether to silently close a tab or keep it open with an explanation, and so
 * the decision is unit-testable without a real terminal.
 *
 * A CLEAN exit (code 0, no signal) means the user typed `exit` or the agent
 * finished — the tab auto-closes. A FAILED exit (non-zero code, or killed by a
 * signal) is surfaced instead, because the most common cause is a mis-launched
 * agent (e.g. its CLI isn't on the login-shell PATH → exit 127) that would
 * otherwise just flash away with no clue why. */
export interface ExitOutcome {
  /** True when the tab should stay open and show why; false → auto-close. */
  failed: boolean
  /** Human-readable cause, e.g. "exit code 127" or "killed by signal 9". */
  reason: string
}

export function classifyExit(exitCode?: number | null, signal?: number | null): ExitOutcome {
  if (signal != null) return { failed: true, reason: `killed by signal ${signal}` }
  if (exitCode != null && exitCode !== 0) return { failed: true, reason: `exit code ${exitCode}` }
  return { failed: false, reason: `exit code ${exitCode ?? 0}` }
}
