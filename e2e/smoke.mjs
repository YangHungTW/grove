/**
 * End-to-end smoke test against the BUILT Electron app. Exercises the full
 * Project → Worktree → Session hierarchy against throwaway temp git repos.
 *
 * Proves:
 *  - multi-project: a seeded recent project + the launched repo both listed,
 *    and selecting one loads its worktrees;
 *  - per-project worktree create (real `git worktree add`);
 *  - split panes (N sessions visible at once);
 *  - full round-trip (renderer→IPC→main→pty→shell side effect on disk).
 *
 * Run: npm run build && node e2e/smoke.mjs   — exit 0 on success.
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import assert from 'node:assert/strict'

function makeRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir })
  return dir
}

const repoA = makeRepo('ccm-e2e-a-')
const repoB = makeRepo('ccm-e2e-b-')
const storeDir = mkdtempSync(join(tmpdir(), 'ccm-store-'))
const storeFile = join(storeDir, 'projects.json')
const wtPath = `${repoA}-wt-feat`
const marker = join(repoA, `marker_${Date.now()}`)
const agentMarker = join(repoA, `agent_${Date.now()}`)
const layoutFile = join(storeDir, 'layout.json')
let app
let failed = false

const launchOpts = {
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    CCM_STORE: storeFile,
    CCM_LAYOUT: layoutFile,
    CCM_REPO_ROOT: repoA,
    // Stand in for the real `claude` CLI so the agent-launch path is testable
    // without auth: typing this into the login shell creates a marker file.
    CCM_AGENT_CMD: `touch '${agentMarker}'`
  }
}

try {
  // Seed the recent-projects store with repoB (simulates a previously-opened project).
  writeFileSync(storeFile, JSON.stringify([{ repoRoot: repoB, name: basename(repoB) }]))

  app = await electron.launch(launchOpts)
  const win = await app.firstWindow()
  await win.waitForSelector('.project-header', { timeout: 15000 })

  // 0) BUNDLED FONT — the Nerd Font is available (not falling back to system).
  const fontLoaded = await win.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check('13px "MesloLGS NF"')
  })
  assert.ok(fontLoaded, 'bundled MesloLGS NF font should be loaded')

  // 1) MULTI-PROJECT — both the seeded repo and the launched repo are listed.
  const projectCount = await win.locator('.project-header').count()
  assert.ok(projectCount >= 2, `expected >= 2 projects listed, got ${projectCount}`)
  const titles = await win.locator('.project-title').allInnerTexts()
  assert.ok(titles.some((t) => t.includes(basename(repoA))), 'launched project A should be listed')
  assert.ok(titles.some((t) => t.includes(basename(repoB))), 'seeded project B should be listed')

  // 2) SELECT PROJECT A — loads its worktrees.
  await win.locator('.project-title', { hasText: basename(repoA) }).click()
  await win.waitForSelector('.project.active .wt-title', { timeout: 10000 })
  const projA = win.locator('.project.active')

  const visCount = () =>
    win.evaluate(
      () => [...document.querySelectorAll('.pane')].filter((p) => getComputedStyle(p).display !== 'none').length
    )

  // 3) TABS + ON-DEMAND SPLIT — two shells become two tabs; single by default,
  //    both visible after toggling split.
  await projA.getByRole('button', { name: '+ shell' }).first().click()
  await win.waitForSelector('.xterm', { timeout: 10000 })
  await projA.getByRole('button', { name: '+ shell' }).first().click()
  await win.waitForFunction(() => document.querySelectorAll('.tab').length >= 2, { timeout: 10000 })
  const tabs = await win.locator('.tab').count()
  assert.ok(tabs >= 2, `tabs: expected >= 2 tabs, got ${tabs}`)
  assert.equal(await visCount(), 1, 'single mode: exactly one pane visible by default')

  await win.locator('#split-toggle').click()
  await win.waitForFunction(
    () => [...document.querySelectorAll('.pane')].filter((p) => getComputedStyle(p).display !== 'none').length >= 2,
    { timeout: 10000 }
  )
  const visible = await visCount()
  assert.ok(visible >= 2, `split: expected >= 2 panes after toggle, got ${visible}`)

  // 3b) DRAG-RESIZE — drag the column divider right; the first column widens.
  const colsCss = () =>
    win.evaluate(() => getComputedStyle(document.getElementById('panes')).gridTemplateColumns)
  const before = (await colsCss()).split(' ').map(parseFloat)
  const gb = await win.locator('.gutter-col').first().boundingBox()
  await win.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2)
  await win.mouse.down()
  await win.mouse.move(gb.x + 160, gb.y + gb.height / 2, { steps: 6 })
  await win.mouse.up()
  await win.waitForTimeout(250)
  const after = (await colsCss()).split(' ').map(parseFloat)
  assert.ok(after[0] > before[0] + 20, `drag-resize: col0 should widen (${before[0]}→${after[0]})`)
  const dragResize = true

  // 4) ROUND-TRIP — typed command creates a real file under repoA.
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
  assert.ok(roundTrip, 'round-trip: marker file should appear under project A')

  // 5) PER-PROJECT WORKTREE — create a real git worktree under A.
  await projA.getByRole('button', { name: '+ worktree' }).click()
  await win.locator('.project.active .wt-input').fill('feat')
  await win.locator('.project.active .wt-input').press('Enter')
  await win.waitForFunction(
    () => [...document.querySelectorAll('.wt-title')].some((t) => t.textContent?.includes('feat')),
    { timeout: 10000 }
  )
  assert.ok(existsSync(join(wtPath, '.git')), `worktree should exist at ${wtPath}`)

  // Re-select A's main worktree.
  await win.locator('.project.active .wt-title', { hasText: 'main' }).first().click()
  await win.waitForTimeout(400)

  // 5b) KEYBOARD NAV — ⌘2 switches to the 2nd worktree (feat), ⌘1 back to main.
  const activeWt = () =>
    win.evaluate(
      () => document.querySelector('.project.active .wt-header.active .wt-title')?.textContent ?? ''
    )
  await win.keyboard.press('Meta+2')
  await win.waitForFunction(
    () => (document.querySelector('.project.active .wt-header.active .wt-title')?.textContent ?? '').includes('feat'),
    { timeout: 5000 }
  )
  await win.keyboard.press('Meta+1')
  await win.waitForFunction(
    () => (document.querySelector('.project.active .wt-header.active .wt-title')?.textContent ?? '').includes('main'),
    { timeout: 5000 }
  )
  const kbdNav = (await activeWt()).includes('main')

  // 6) AGENT LAUNCH — '+ agent' starts the login shell + bootstraps the agent
  //    command (here CCM_AGENT_CMD), which creates a marker file on disk.
  await projA.getByRole('button', { name: '+ agent' }).click()
  let agentLaunched = false
  for (let i = 0; i < 60; i++) {
    if (existsSync(agentMarker)) {
      agentLaunched = true
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  assert.ok(agentLaunched, 'agent launch: CCM_AGENT_CMD marker should appear on disk')

  // 7) MULTIPLE AGENTS — a second '+ agent' is allowed (two ★ agents).
  await projA.getByRole('button', { name: '+ agent' }).click()
  await win.waitForFunction(
    () => [...document.querySelectorAll('.session-label')].filter((l) => l.textContent?.includes('★')).length >= 2,
    { timeout: 5000 }
  )
  const agentRows = await win.locator('.session-label', { hasText: '★' }).count()
  assert.equal(agentRows, 2, `multi-agent: expected 2 agent rows, got ${agentRows}`)

  // 7b) PROJECT SWITCH preserves sessions — switch to B then back to A.
  await win.locator('.project-title', { hasText: basename(repoB) }).click()
  await win.waitForFunction(
    (b) => (document.querySelector('.project.active .project-title')?.textContent ?? '').includes(b),
    basename(repoB),
    { timeout: 5000 }
  )
  await win.locator('.project-title', { hasText: basename(repoA) }).click()
  await win.waitForSelector('.project.active .wt-title', { timeout: 5000 })
  await win.waitForTimeout(300)
  const agentAfterSwitch = await win.locator('.session-label', { hasText: '★' }).count()
  assert.equal(agentAfterSwitch, 2, `project switch lost agents (★=${agentAfterSwitch})`)
  const visibleAfterSwitch = await win.evaluate(
    () => [...document.querySelectorAll('.pane')].filter((p) => getComputedStyle(p).display !== 'none').length
  )
  assert.ok(visibleAfterSwitch >= 1, `project switch hid all panes (visible=${visibleAfterSwitch})`)

  await win.screenshot({ path: join(process.cwd(), 'e2e', 'smoke.png') })

  // 8) PERSISTENCE — close, relaunch with the same stores; sessions are restored.
  await win.waitForTimeout(600) // let the final layout save flush
  await app.close()
  app = await electron.launch(launchOpts)
  const win2 = await app.firstWindow()
  await win2.waitForSelector('.project.active .wt-title', { timeout: 15000 })
  // Restored sessions show as tabs (split mode isn't persisted, so one pane shows).
  await win2.waitForFunction(() => document.querySelectorAll('.tab').length >= 2, { timeout: 15000 })
  const restored = await win2.locator('.tab').count()
  assert.ok(restored >= 2, `persistence: expected >= 2 restored sessions, got ${restored}`)

  console.log(
    `SMOKE_OK fontLoaded=${fontLoaded} projects=${projectCount} split=${visible} dragResize=${dragResize} roundTrip=true ` +
      `worktreeCreated=true agentLaunched=true multiAgent=${agentRows === 2} ` +
      `agentAfterSwitch=${agentAfterSwitch} kbdNav=${kbdNav} restored=${restored}`
  )
} catch (err) {
  failed = true
  console.error('SMOKE_FAIL', err?.stack ?? err?.message ?? err)
} finally {
  if (app) await app.close()
  for (const d of [repoA, repoB, wtPath, storeDir]) rmSync(d, { recursive: true, force: true })
  rmSync(agentMarker, { force: true })
}

process.exit(failed ? 1 : 0)
