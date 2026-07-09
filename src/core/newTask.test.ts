import { describe, it, expect } from 'vitest'
import { withInitialPrompt, suggestBranch } from './newTask'

describe('withInitialPrompt', () => {
  it('appends the prompt single-quoted as one positional argument', () => {
    expect(withInitialPrompt('claude --session-id abc', 'fix the login bug')).toBe(
      "claude --session-id abc 'fix the login bug'"
    )
  })

  it('escapes embedded single quotes (POSIX close-escape-reopen)', () => {
    expect(withInitialPrompt('claude', "don't break")).toBe(`claude 'don'\\''t break'`)
  })

  it('preserves newlines in multi-line prompts', () => {
    expect(withInitialPrompt('claude', 'line one\nline two')).toBe("claude 'line one\nline two'")
  })

  it('returns the command unchanged for an empty/whitespace prompt', () => {
    expect(withInitialPrompt('claude')).toBe('claude')
    expect(withInitialPrompt('claude', '   ')).toBe('claude')
  })
})

describe('suggestBranch', () => {
  it('slugs the first words under a task/ prefix', () => {
    expect(suggestBranch('Fix the login-page render bug on retina')).toBe('task/fix-the-login-page')
  })

  it('drops punctuation and collapses separators', () => {
    expect(suggestBranch('Add OAuth (Google + GitHub)!')).toBe('task/add-oauth-google-github')
  })

  it('returns empty for an empty prompt (no bare task/ suggestion)', () => {
    expect(suggestBranch('')).toBe('')
    expect(suggestBranch('  …  ')).toBe('')
  })
})
