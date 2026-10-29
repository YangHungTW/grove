/**
 * Shared setup for the worktree.*.test.ts files (not a test file itself — the
 * vitest include is `*.test.ts`).
 *
 * One TEMPLATE repo per file (init + user config + first commit = three git
 * spawns), copied per test with cpSync: the copy carries its own `.git`, so a
 * test can mutate it freely, and a directory copy is far cheaper than the git
 * spawns it replaces. Each copy is its own mkdtemp under tmpdir — tests create
 * linked worktrees at `join(repo, '..', …)`, so the parent must be a shared,
 * writable directory and the repo name unique.
 */
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** Register the per-file template + per-test copy hooks. `set` receives the
 * fresh repo path before each test (the files keep a plain `repo` variable so
 * the test bodies read exactly as they did in the single-file original). */
export function useTempRepo(set: (repo: string) => void): void {
  let template = ''
  let repo = ''
  beforeAll(() => {
    template = mkdtempSync(join(tmpdir(), 'ccm-wt-tmpl-'))
    gitIn(template, ['init', '-q', '-b', 'main'])
    gitIn(template, ['config', 'user.email', 'test@example.com'])
    gitIn(template, ['config', 'user.name', 'Test'])
    writeFileSync(join(template, 'README.md'), '# temp\n')
    gitIn(template, ['add', '.'])
    gitIn(template, ['commit', '-q', '-m', 'init'])
  })
  afterAll(() => {
    rmSync(template, { recursive: true, force: true })
  })
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'ccm-wt-'))
    cpSync(template, repo, { recursive: true })
    set(repo)
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })
}
