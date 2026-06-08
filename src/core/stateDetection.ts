import type { SessionState } from './types'

/**
 * A detection rule: if `pattern` matches the (stripped) buffer tail, the
 * session is in `state`. Rules are evaluated in array order, so list the
 * highest-priority states first (waiting > busy), with idle as the fallback.
 */
interface DetectRule {
  state: Extract<SessionState, 'waiting' | 'busy'>
  pattern: RegExp
}

/**
 * Per-agent rule sets. Keep these data-driven so they can be tuned without
 * touching logic when an agent CLI changes its output. Ported in spirit from
 * ccmanager's per-assistant state-detection strategies.
 */
const STRATEGIES: Record<string, DetectRule[]> = {
  claude: [
    // Approval / question prompts → needs the user.
    { state: 'waiting', pattern: /do you want to (proceed|continue)\??/i },
    { state: 'waiting', pattern: /❯\s*\d+\.\s/ },
    { state: 'waiting', pattern: /\(y\/n\)/i },
    // Active work → spinner + interrupt hint.
    { state: 'busy', pattern: /esc to interrupt/i },
    { state: 'busy', pattern: /^[\s]*[✻✽✺✶✳*]\s/m }
  ]
}

const ANSI = /[][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-ORZcf-nqry=><]/g

/** Strip ANSI escape sequences so patterns match the visible text. */
function stripAnsi(input: string): string {
  return input.replace(ANSI, '')
}

/**
 * Classify a terminal output buffer into a {@link SessionState}.
 *
 * Returns `idle` for unknown agents or when no rule matches — idle is the safe
 * default (a session that needs nothing).
 */
export function detectState(buffer: string, agent: string): SessionState {
  const rules = STRATEGIES[agent]
  if (!rules) return 'idle'

  const text = stripAnsi(buffer)
  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule.state
  }
  return 'idle'
}

/** Agents with a registered detection strategy. */
export function supportedAgents(): string[] {
  return Object.keys(STRATEGIES)
}
