import { describe, it, expect } from 'vitest'
import { cardPath } from './cardPath'

describe('cardPath — hiding a folder line that repeats the card', () => {
  it('hides the project’s own checkout, which the header above already names', () => {
    expect(cardPath('monaco-rails', 'monaco-rails', 'main')).toBe('')
  })

  it('hides the default template’s folder — project name + branch, both on screen', () => {
    expect(cardPath('monaco-rails-wt-feat', 'monaco-rails', 'feat')).toBe('')
  })

  it('hides a branch-only folder (a {branch} template)', () => {
    expect(cardPath('feat', 'monaco-rails', 'feat')).toBe('')
  })

  it('hides it when the template flattened a slash in the branch', () => {
    // expandWorktreeTemplate rewrites anything outside [\w.-] as '_'.
    expect(cardPath('monaco-rails-wt-yang_fix-login', 'monaco-rails', 'yang/fix-login')).toBe('')
  })

  it('shows a folder that carries something new', () => {
    // A hand-made worktree parked somewhere unrelated — the only place the card
    // could tell you where it actually lives.
    expect(cardPath('scratch-checkout', 'monaco-rails', 'feat')).toBe('scratch-checkout')
  })

  it('shows a folder stamped with a timestamp, which nothing else displays', () => {
    expect(cardPath('monaco-rails-wt-feat-20260731', 'monaco-rails', 'feat')).toBe(
      'monaco-rails-wt-feat-20260731'
    )
  })

  it('shows a folder that merely starts with the project name', () => {
    expect(cardPath('monaco-rails-old', 'monaco-rails', 'feat')).toBe('monaco-rails-old')
  })

  it('handles a detached worktree with no branch', () => {
    expect(cardPath('monaco-rails', 'monaco-rails', '')).toBe('')
    expect(cardPath('detached-thing', 'monaco-rails', '')).toBe('detached-thing')
  })

  it('has nothing to show for an empty folder', () => {
    expect(cardPath('', 'monaco-rails', 'feat')).toBe('')
  })
})
