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
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
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
const settingsFile = join(storeDir, 'settings.json')
const wtPath = `${repoA}-wt-feat`
const marker = join(repoA, `marker_${Date.now()}`)
const agentMarker = join(repoA, `agent_${Date.now()}`)
const ideMarker = join(repoA, `ide_${Date.now()}`)
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
    CCM_SETTINGS: settingsFile,
    CCM_REPO_ROOT: repoA,
    // Stand in for the real `claude` CLI so the agent-launch path is testable
    // without auth: typing this into the login shell creates a marker file.
    CCM_AGENT_CMD: `touch '${agentMarker}'; sleep 30`,
    // Stand in for a real GUI editor (like CCM_AGENT_CMD): records the opened file
    // path (passed as "$1" by openInEditor) into a marker we can assert on.
    CCM_IDE_CMD: `node -e "require('fs').writeFileSync(process.argv[1], process.argv[2])" '${ideMarker}'`
  }
}

try {
  // Seed the recent-projects store with repoB (simulates a previously-opened project).
  writeFileSync(storeFile, JSON.stringify([{ repoRoot: repoB, name: basename(repoB) }]))
  // Seed a configured GUI editor so the diff view's open-in-IDE icon is enabled.
  // The real command ('code') is overridden by CCM_IDE_CMD; this only flips the
  // canOpenInIde gate on.
  writeFileSync(settingsFile, JSON.stringify({ ide: { command: 'code', terminal: false } }))

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
  const projectCount = await win.locator('.project-name').count()
  assert.ok(projectCount >= 2, `expected >= 2 projects listed, got ${projectCount}`)
  const titles = await win.locator('.project-name').allInnerTexts()
  assert.ok(titles.some((t) => t.includes(basename(repoA))), 'launched project A should be listed')
  assert.ok(titles.some((t) => t.includes(basename(repoB))), 'seeded project B should be listed')

  // 2) SELECT PROJECT A's main worktree card.
  const groupA = win.locator('.project-group').filter({ hasText: basename(repoA) })
  const groupB = win.locator('.project-group').filter({ hasText: basename(repoB) })
  await groupA.locator('.card', { hasText: 'main' }).first().click()
  await win.waitForSelector('.card.active', { timeout: 10000 })

  // 2b) SIDEBAR RESIZE — drag the divider right; the sidebar column widens.
  const appCol0 = async () =>
    parseFloat(
      (await win.evaluate(
        () => getComputedStyle(document.getElementById('app')).gridTemplateColumns
      )).split(' ')[0]
    )
  const sbBefore = await appCol0()
  const rb = await win.locator('.sidebar-resizer').boundingBox()
  await win.mouse.move(rb.x + rb.width / 2, rb.y + 200)
  await win.mouse.down()
  await win.mouse.move(rb.x + 120, rb.y + 200, { steps: 6 })
  await win.mouse.up()
  await win.waitForTimeout(200)
  const sbAfter = await appCol0()
  assert.ok(sbAfter > sbBefore + 40, `sidebar resize: col0 should widen (${sbBefore}→${sbAfter})`)
  const sidebarResize = true

  const visCount = () =>
    win.evaluate(
      () => [...document.querySelectorAll('.pane')].filter((p) => getComputedStyle(p).display !== 'none').length
    )

  // 3) TABS + ON-DEMAND SPLIT — two shells become two tabs; single by default,
  //    both visible after toggling split. '+ shell' lives in the top toolbar.
  await win.getByRole('button', { name: 'New shell' }).click()
  await win.waitForSelector('.xterm', { timeout: 10000 })
  await win.getByRole('button', { name: 'New shell' }).click()
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

  // 3c) ZOOM — ⌃⇧T (configurable) maximizes the focused pane, toggles back.
  await win.keyboard.press('Control+Shift+T')
  await win.waitForFunction(
    () => [...document.querySelectorAll('.pane')].filter((p) => getComputedStyle(p).display !== 'none').length === 1,
    { timeout: 5000 }
  )
  await win.keyboard.press('Control+Shift+T')
  await win.waitForFunction(
    () => [...document.querySelectorAll('.pane')].filter((p) => getComputedStyle(p).display !== 'none').length >= 2,
    { timeout: 5000 }
  )
  const zoomToggle = true

  // 3d) FIND IN TERMINAL — ⌘F opens the search bar; Esc closes it.
  await win.locator('.pane.focused .xterm-helper-textarea').focus()
  await win.keyboard.press('Meta+f')
  await win.waitForSelector('.term-search input', { timeout: 5000 })
  await win.locator('.term-search input').fill('hello')
  await win.keyboard.press('Escape')
  await win.waitForFunction(() => !document.querySelector('.term-search'), { timeout: 5000 })
  const termSearch = true

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

  // 5) PER-PROJECT WORKTREE — create a real git worktree under A via the dialog.
  await groupA.locator('.proj-btn').first().click() // "+" new worktree
  await win.waitForSelector('.dialog-field input', { timeout: 5000 })
  await win.locator('.dialog-field input').fill('feat')
  await win.getByRole('button', { name: 'Create worktree' }).click()
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
    await win.getByRole('button', { name: 'New agent' }).click()
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

  // 7) MULTIPLE AGENTS — a second agent is allowed (two agent tabs).
  await addClaudeAgent()
  await win.waitForFunction(
    () => document.querySelectorAll('.tab[data-kind="agent"]').length >= 2,
    { timeout: 5000 }
  )
  const agentRows = await win.locator('.tab[data-kind="agent"]').count()
  assert.equal(agentRows, 2, `multi-agent: expected 2 agent tabs, got ${agentRows}`)

  // 7b) WORKTREE SWITCH preserves sessions — select B's card then back to A's.
  await groupB.locator('.card').first().click()
  await win.waitForTimeout(300)
  await groupA.locator('.card', { hasText: 'main' }).first().click()
  await win.waitForTimeout(300)
  const agentAfterSwitch = await win.locator('.tab[data-kind="agent"]').count()
  assert.equal(agentAfterSwitch, 2, `worktree switch lost agents (count=${agentAfterSwitch})`)

  // 7b-ii) NEW AGENT SHORTCUT — Ctrl+Shift+A adds an agent: it opens the chooser
  //        menu when several agents are installed (click the first), or adds the
  //        only installed one directly. Either way an agent tab is created.
  const agentsBeforeKey = await win.locator('.tab[data-kind="agent"]').count()
  await win.locator('.pane.focused .xterm-helper-textarea').focus()
  await win.keyboard.press('Control+Shift+A')
  const agentChooserMenu = win.locator('.agent-menu')
  if (await agentChooserMenu.count()) await agentChooserMenu.locator('button').first().click()
  await win.waitForFunction(
    (n) => document.querySelectorAll('.tab[data-kind="agent"]').length > n,
    agentsBeforeKey,
    { timeout: 5000 }
  )
  const newAgentShortcut = true

  // 7c) FILE VIEWER — open a Markdown and an HTML file in read-only viewer panes
  //     (driven through the in-app dialog so no native OS picker is needed).
  const mdFile = join(repoA, 'VIEWME.md')
  const htmlFile = join(repoA, 'VIEWME.html')
  writeFileSync(mdFile, '# HelloViewer\n\nsome **markdown** body\n')
  writeFileSync(htmlFile, '<!doctype html><html><body><p>HTMLVIEW</p></body></html>')

  const openFileViaDialog = async (path) => {
    await win.getByRole('button', { name: 'Open file' }).click()
    await win.waitForSelector('.dialog-field input', { timeout: 5000 })
    await win.locator('.dialog-field input').fill(path)
    await win.getByRole('button', { name: 'Open', exact: true }).click()
  }

  await openFileViaDialog(mdFile)
  // Markdown is rendered to an <h1> carrying the heading text.
  await win.waitForFunction(
    () => {
      const h = document.querySelector('.pane[data-kind="viewer"] .viewer-markdown h1')
      return !!h && (h.textContent || '').includes('HelloViewer')
    },
    { timeout: 10000 }
  )

  await openFileViaDialog(htmlFile)
  // The HTML viewer renders inside a sandboxed <iframe>.
  await win.waitForFunction(
    () =>
      [...document.querySelectorAll('.pane[data-kind="viewer"]')].some((p) =>
        p.querySelector('iframe.viewer-frame')
      ),
    { timeout: 10000 }
  )
  const viewerPanes = await win.locator('.pane[data-kind="viewer"]').count()
  const htmlIframe = await win.locator('.pane[data-kind="viewer"] iframe').count()
  assert.ok(viewerPanes >= 2, `viewer: expected >= 2 viewer panes, got ${viewerPanes}`)
  assert.ok(htmlIframe >= 1, `viewer: expected an <iframe> in the html pane, got ${htmlIframe}`)
  const fileViewer = true

  // 7d) WORKTREE DIFF / REVIEW — make a committed + uncommitted change in the
  //     feat worktree, open its review pane from the sidebar card, and assert
  //     added AND removed lines render.
  execFileSync('git', ['-C', wtPath, 'config', 'user.email', 't@e.com'])
  execFileSync('git', ['-C', wtPath, 'config', 'user.name', 'T'])
  writeFileSync(join(wtPath, 'diffme.txt'), 'alpha\n')
  execFileSync('git', ['-C', wtPath, 'add', 'diffme.txt'])
  execFileSync('git', ['-C', wtPath, 'commit', '-q', '-m', 'add diffme'])
  writeFileSync(join(wtPath, 'diffme.txt'), 'beta\n') // uncommitted modification → +/−

  await groupA
    .locator('.card', { hasText: 'feat' })
    .getByRole('button', { name: 'Review changes' })
    .click()
  await win.waitForFunction(
    () => {
      const p = document.querySelector('.pane[data-kind="diff"]')
      return !!p && !!p.querySelector('.diff-line-add') && !!p.querySelector('.diff-line-del')
    },
    { timeout: 10000 }
  )
  const diffPanes = await win.locator('.pane[data-kind="diff"]').count()
  const addLines = await win.locator('.pane[data-kind="diff"] .diff-line-add').count()
  const delLines = await win.locator('.pane[data-kind="diff"] .diff-line-del').count()
  assert.ok(diffPanes >= 1, `diff: expected a diff pane, got ${diffPanes}`)
  assert.ok(addLines >= 1, `diff: expected added lines, got ${addLines}`)
  assert.ok(delLines >= 1, `diff: expected removed lines, got ${delLines}`)
  const diffReview = true

  // 7d-ii) OPEN IN IDE — the per-file icon is enabled (an editor is configured),
  //        and clicking it launches the editor on that file. CCM_IDE_CMD stands in
  //        for the GUI editor and records the opened path to a marker.
  const ideBtn = win.locator('.pane[data-kind="diff"] .diff-open-ide').first()
  assert.equal(await ideBtn.isDisabled(), false, 'open-in-IDE: icon should be enabled when configured')
  await ideBtn.click()
  let ideOpened = false
  for (let i = 0; i < 40; i++) {
    if (existsSync(ideMarker)) {
      ideOpened = true
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  assert.ok(ideOpened, 'open-in-IDE: CCM_IDE_CMD marker should appear on disk')
  const ideTarget = readFileSync(ideMarker, 'utf8')
  assert.ok(
    ideTarget.includes('diffme.txt'),
    `open-in-IDE: marker should name the opened file, got "${ideTarget}"`
  )
  const ideOpen = true

  // 7e) SPLIT DIFF — toggling to side-by-side renders paired rows, and back.
  await win.locator('.diff-view-toggle button', { hasText: 'Split' }).click()
  await win.waitForSelector('.pane[data-kind="diff"] .diff-srow', { timeout: 5000 })
  const splitDel = await win.locator('.pane[data-kind="diff"] .diff-scell-del').count()
  const splitAdd = await win.locator('.pane[data-kind="diff"] .diff-scell-add').count()
  assert.ok(splitDel >= 1 && splitAdd >= 1, `split diff: del=${splitDel} add=${splitAdd}`)
  await win.locator('.diff-view-toggle button', { hasText: 'Unified' }).click()
  await win.waitForSelector('.pane[data-kind="diff"] .diff-line-add', { timeout: 5000 })
  const splitDiff = true

  // 7f) FINISH WORKTREE — commit the dirty change, merge feat into main, and
  //     remove the worktree (the full one-click wrap-up).
  await groupA
    .locator('.card', { hasText: 'feat' })
    .getByRole('button', { name: 'Finish worktree' })
    .click()
  await win.waitForSelector('.dialog-field input', { timeout: 5000 })
  await win.locator('.dialog-field input').fill('finish: diffme beta')
  await win.getByRole('button', { name: 'Finish', exact: true }).click()
  await win.waitForFunction(
    () => ![...document.querySelectorAll('.card-title')].some((t) => t.textContent?.includes('feat')),
    { timeout: 15000 }
  )
  const mainLog = execFileSync('git', ['-C', repoA, 'log', '-1', '--format=%s', 'main'], {
    encoding: 'utf8'
  })
  assert.ok(mainLog.includes('finish: diffme beta'), `finish: main log got "${mainLog.trim()}"`)
  assert.ok(!existsSync(join(wtPath, '.git')), 'finish: worktree folder should be removed')
  const finishFlow = true

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
      `sidebarResize=${sidebarResize} zoom=${zoomToggle} termSearch=${termSearch} ` +
      `worktreeCreated=true agentLaunched=true multiAgent=${agentRows === 2} ` +
      `agentAfterSwitch=${agentAfterSwitch} newAgentShortcut=${newAgentShortcut} kbdNav=${kbdNav} fileViewer=${fileViewer} ` +
      `viewerPanes=${viewerPanes} htmlIframe=${htmlIframe} diffReview=${diffReview} ` +
      `diffAdd=${addLines} diffDel=${delLines} splitDiff=${splitDiff} ideOpen=${ideOpen} finish=${finishFlow} restored=${restored}`
  )
} catch (err) {
  failed = true
  console.error('SMOKE_FAIL', err?.stack ?? err?.message ?? err)
} finally {
  if (app) await app.close()
  for (const d of [repoA, repoB, wtPath, storeDir]) rmSync(d, { recursive: true, force: true })
  rmSync(agentMarker, { force: true })
  rmSync(ideMarker, { force: true })
}

process.exit(failed ? 1 : 0)
