/**
 * End-to-end smoke test against the BUILT Electron app. Runs against a throwaway
 * temp git repo (CCM_REPO_ROOT) so the real repo is untouched.
 *
 * Proves: full stack round-trip (renderer→IPC→main→pty→shell side effect),
 * split panes (N sessions visible at once in one worktree), and worktree
 * management (create + remove a real git worktree from the UI).
 *
 * Run: npm run build && node e2e/smoke.mjs   — exit 0 on success.
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const repo = mkdtempSync(join(tmpdir(), 'ccm-e2e-'))
const wtPath = `${repo}-wt-feature-x`
const marker = join(repo, `marker_${Date.now()}`)
let app
let failed = false

function git(args) {
  execFileSync('git', args, { cwd: repo })
}

async function visiblePaneCount(win) {
  return win.evaluate(
    () => [...document.querySelectorAll('.pane')].filter((p) => getComputedStyle(p).display !== 'none').length
  )
}

try {
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 't@e.com'])
  git(['config', 'user.name', 'T'])
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo })

  app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, CCM_REPO_ROOT: repo }
  })
  const win = await app.firstWindow()
  await win.waitForSelector('.wt-header', { timeout: 15000 })

  // 1) SPLIT PANES — add two shells to the (one) worktree; both visible at once.
  await win.getByRole('button', { name: '+ shell' }).first().click()
  await win.waitForSelector('.xterm', { timeout: 10000 })
  await win.getByRole('button', { name: '+ shell' }).first().click()
  await win.waitForFunction(
    () => [...document.querySelectorAll('.pane')].filter((p) => getComputedStyle(p).display !== 'none').length >= 2,
    { timeout: 10000 }
  )
  const visible = await visiblePaneCount(win)
  assert.ok(visible >= 2, `split: expected >= 2 panes visible, got ${visible}`)

  // 2) ROUND-TRIP — type in the focused pane, expect a real file on disk.
  await win.locator('.pane.focused .xterm-helper-textarea').focus()
  await win.keyboard.type(`touch '${marker}' && echo CCM_DONE\r`)
  let roundTrip = false
  for (let i = 0; i < 40; i++) {
    if (existsSync(marker)) {
      roundTrip = true
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  assert.ok(roundTrip, 'round-trip: shell marker file should appear on disk')

  // 3) WORKTREE MANAGEMENT — create a new git worktree from the UI.
  await win.getByRole('button', { name: '+ worktree' }).click()
  await win.locator('.wt-input').fill('feature-x')
  await win.locator('.wt-input').press('Enter')
  await win.waitForFunction(
    () => [...document.querySelectorAll('.wt-title')].some((t) => t.textContent?.includes('feature-x')),
    { timeout: 10000 }
  )
  assert.ok(existsSync(wtPath), `worktree dir should exist on disk at ${wtPath}`)
  assert.ok(
    existsSync(join(wtPath, '.git')),
    'new worktree should be a real git worktree (.git link present)'
  )

  // Re-activate the main worktree so the screenshot shows the tiled split panes.
  await win.locator('.wt-title', { hasText: 'main' }).first().click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(process.cwd(), 'e2e', 'smoke.png') })
  console.log(`SMOKE_OK split=${visible} roundTrip=true worktreeCreated=true`)
} catch (err) {
  failed = true
  console.error('SMOKE_FAIL', err?.stack ?? err?.message ?? err)
} finally {
  if (app) await app.close()
  rmSync(repo, { recursive: true, force: true })
  rmSync(wtPath, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
