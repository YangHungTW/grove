/** Pure helpers for the "New task" flow (create a worktree + launch an agent
 * with an initial prompt in one step). Electron-free and unit-tested. */

import { shellQuote } from './shellQuote'

/**
 * Append an initial prompt to an agent launch command as a positional argument
 * — the convention the major agent CLIs share (`claude "..."`, `codex "..."`
 * start interactive with that prompt already submitted). The prompt is
 * single-quoted so spaces/newlines/quotes survive the `$SHELL -ilc` launch
 * (and the extra tmux quoting layer of durable sessions, which re-escapes
 * embedded single quotes itself).
 */
export function withInitialPrompt(command: string, prompt?: string): string {
  const p = prompt?.trim()
  if (!p) return command
  return `${command} ${shellQuote(p)}`
}

/**
 * Suggest a git branch name from a task prompt: `task/` + the first few words,
 * lowercased and slugged. Purely a starting point — the dialog leaves it
 * editable. Returns '' for an effectively-empty prompt (the field stays blank
 * rather than suggesting `task/`).
 */
export function suggestBranch(prompt: string, maxWords = 4): string {
  const words = prompt
    .toLowerCase()
    // Keep letters/digits (unicode) as word characters; everything else splits.
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, maxWords)
  return words.length ? `task/${words.join('-')}` : ''
}
