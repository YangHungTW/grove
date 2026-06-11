/** Throwaway probe: count pty resizes during startup and split toggles.
 * Run: npm run build && node e2e/resize-probe.mjs */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = mkdtempSync(join(tmpdir(), 'ccm-probe-'))
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: repo })
execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo })
execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo })
const storeDir = mkdtempSync(join(tmpdir(), 'ccm-probe-store-'))

const events = []
const app = await electron.launch({
  args: ['.'],
  env: {
    ...process.env,
    CCM_STORE: join(storeDir, 'projects.json'),
    CCM_LAYOUT: join(storeDir, 'layout.json'),
    CCM_SETTINGS: join(storeDir, 'settings.json'),
    CCM_REPO_ROOT: repo,
    CCM_DEBUG_RESIZE: '1'
  }
})
app.process().stdout.on('data', (d) => {
  for (const line of String(d).split('\n')) if (line.includes('[resize]')) events.push(line.trim())
})

const win = await app.firstWindow()
await win.waitForSelector('.project-group', { timeout: 15000 })
await win.locator('.card').first().click()

const mark = async (label, ms = 1500) => {
  await win.waitForTimeout(ms)
  console.log(`--- ${label}: ${events.length} resizes total`)
  for (const e of events) console.log('   ', e)
  events.length = 0
}

await win.getByRole('button', { name: 'New shell' }).click()
await win.waitForSelector('.xterm', { timeout: 10000 })
await mark('after shell 1')

await win.getByRole('button', { name: 'New shell' }).click()
await win.waitForTimeout(500)
await mark('after shell 2')

await win.locator('#split-toggle').click()
await mark('after split ON')

await win.locator('#split-toggle').click()
await mark('after split OFF (merge)')

await win.locator('#split-toggle').click()
await mark('after split ON again')
await win.screenshot({ path: 'e2e/probe-after-3-toggles.png' })

await win.locator('#split-toggle').click()
await win.waitForTimeout(800)
await win.locator('#split-toggle').click()
await win.waitForTimeout(800)
await win.locator('#split-toggle').click()
await win.waitForTimeout(800)
await mark('after 3 more toggles')
await win.screenshot({ path: 'e2e/probe-after-6-toggles.png' })

await app.close()
rmSync(repo, { recursive: true, force: true })
rmSync(storeDir, { recursive: true, force: true })
