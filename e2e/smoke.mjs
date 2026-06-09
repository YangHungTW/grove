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
    CCM_SETTINGS: join(storeDir, 'settings.json'),
    CCM_REPO_ROOT: repoA,
    // Stand in for the real `claude` CLI so the agent-launch path is testable
    // without auth: typing this into the login shell creates a marker file.
    CCM_AGENT_CMD: `touch '${agentMarker}'; sleep 30`
  }
}

try {
  // Seed the recent-projects store with repoB (simulates a previously-opened project).
  writeFileSync(storeFile, JSON.stringify([{ repoRoot: repoB, name: basename(repoB) }]))

  app = await electron.launch(launchOpts)
  const win = await app.firstWindow()
  await win.waitForSelector('.project-group', { timeout: 15000 })

  // 0) BUNDLED FONT — the Nerd Font is available (not falling back to system).
  const fontLoaded = await win.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check('13px "MesloLGS NF"')
  })
  assert.ok(fontLoaded, 'bundled MesloLGS NF font should be loaded')

  // 1) MULTI-PROJECT — both the seeded repo and the launched repo are listed.
  const projectCount = await win.locator('.group-name').count()
  assert.ok(projectCount >= 2, `expected >= 2 projects listed, got ${projectCount}`)
  const titles = await win.locator('.group-name').allInnerTexts()
  assert.ok(titles.some((t) => t.includes(basename(repoA))), 'launched project A should be listed')
  assert.ok(titles.some((t) => t.includes(basename(repoB))), 'seeded project B should be listed')

  // 2) SELECT PROJECT A's main worktree card.
  const groupA = win.locator('.project-group').filter({ hasText: basename(repoA) })
  const groupB = win.locator('.project-group').filter({ hasText: basename(repoB) })
  await groupA.locator('.card', { hasText: 'main' }).first().click()
  await win.waitForSelector('.card.active', { timeout: 10000 })

  const visCount = () =>
    win.evaluate(
      () => [...document.querySelectorAll('.pane')].filter((p) => getComputedStyle(p).display !== 'none').length
    )

  // 3) TABS + ON-DEMAND SPLIT — two shells become two tabs; single by default,
  //    both visible after toggling split. '+ shell' lives in the top toolbar.
  await win.getByRole('button', { name: '+ shell' }).click()
  await win.waitForSelector('.xterm', { timeout: 10000 })
  await win.getByRole('button', { name: '+ shell' }).click()
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

  // No bottom-line clip: each visible terminal must fit within its pane.
  await win.waitForTimeout(300)
  const noClip = await win.evaluate(() =>
    [...document.querySelectorAll('.pane')]
      .filter((p) => getComputedStyle(p).display !== 'none')
      .every((p) => {
        const xt = p.querySelector('.xterm')
        return !xt || xt.getBoundingClientRect().height <= p.getBoundingClientRect().height + 2
      })
  )
  assert.ok(noClip, 'pane terminal overflows its pane (bottom-line clip)')

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

  // 5) PER-PROJECT WORKTREE — create a real git worktree under A (group "+").
  await groupA.locator('.group-add').click()
  await groupA.locator('.wt-input').fill('feat')
  await groupA.locator('.wt-input').press('Enter')
  await win.waitForFunction(
    () => [...document.querySelectorAll('.card-title')].some((t) => t.textContent?.includes('feat')),
    { timeout: 10000 }
  )
  assert.ok(existsSync(join(wtPath, '.git')), `worktree should exist at ${wtPath}`)

  // Re-select A's main worktree card.
  await groupA.locator('.card', { hasText: 'main' }).first().click()
  await win.waitForTimeout(400)

  // 5b) KEYBOARD NAV — ⌘2 switches to the 2nd worktree (feat), ⌘1 back to main.
  const activeCard = () =>
    win.evaluate(() => document.querySelector('.card.active .card-title')?.textContent ?? '')
  await win.keyboard.press('Meta+2')
  await win.waitForFunction(
    () => (document.querySelector('.card.active .card-title')?.textContent ?? '').includes('feat'),
    { timeout: 5000 }
  )
  await win.keyboard.press('Meta+1')
  await win.waitForFunction(
    () => (document.querySelector('.card.active .card-title')?.textContent ?? '').includes('main'),
    { timeout: 5000 }
  )
  const kbdNav = (await activeCard()).includes('main')

  // Add a Claude agent — '+ agent' is a dropdown when multiple agents are
  // installed; pick Claude (icon ★). CCM_AGENT_CMD overrides the launch command.
  const addClaudeAgent = async () => {
    await win.getByRole('button', { name: '+ agent' }).click()
    const menu = win.locator('.agent-menu')
    if (await menu.count()) await menu.getByRole('button', { name: 'Claude' }).click()
  }

  // 6) AGENT LAUNCH — creates the CCM_AGENT_CMD marker on disk.
  await addClaudeAgent()
  let agentLaunched = false
  for (let i = 0; i < 60; i++) {
    if (existsSync(agentMarker)) {
      agentLaunched = true
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  assert.ok(agentLaunched, 'agent launch: CCM_AGENT_CMD marker should appear on disk')

  // 7) MULTIPLE AGENTS — a second agent is allowed (two ★ agent tabs).
  await addClaudeAgent()
  await win.waitForFunction(
    () => [...document.querySelectorAll('.tab-title')].filter((l) => l.textContent?.includes('★')).length >= 2,
    { timeout: 5000 }
  )
  const agentRows = await win.locator('.tab-title', { hasText: '★' }).count()
  assert.equal(agentRows, 2, `multi-agent: expected 2 agent tabs, got ${agentRows}`)

  // 7b) WORKTREE SWITCH preserves sessions — select B's card then back to A's.
  await groupB.locator('.card').first().click()
  await win.waitForTimeout(300)
  await groupA.locator('.card', { hasText: 'main' }).first().click()
  await win.waitForTimeout(300)
  const agentAfterSwitch = await win.locator('.tab-title', { hasText: '★' }).count()
  assert.equal(agentAfterSwitch, 2, `worktree switch lost agents (★=${agentAfterSwitch})`)

  await win.screenshot({ path: join(process.cwd(), 'e2e', 'smoke.png') })

  // 8) PERSISTENCE — close, relaunch with the same stores; sessions are restored.
  await win.waitForTimeout(600) // let the final layout save flush
  await app.close()
  app = await electron.launch(launchOpts)
  const win2 = await app.firstWindow()
  await win2.waitForSelector('.card', { timeout: 15000 })
  // Restored sessions show as tabs for the auto-selected worktree.
  await win2.waitForFunction(() => document.querySelectorAll('.tab').length >= 2, { timeout: 15000 })
  const restored = await win2.locator('.tab').count()
  assert.ok(restored >= 2, `persistence: expected >= 2 restored sessions, got ${restored}`)

  console.log(
    `SMOKE_OK fontLoaded=${fontLoaded} noClip=${noClip} projects=${projectCount} split=${visible} dragResize=${dragResize} roundTrip=true ` +
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
