import { describe, it, expect } from 'vitest'
import { PtySession } from './session'

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('PtySession — pty lifecycle', () => {
  it('emits data when the spawned process writes output', async () => {
    const s = new PtySession({
      worktreeId: 'wt-1',
      kind: 'shell',
      command: 'bash',
      args: ['-lc', 'echo PTY_DATA_MARKER'],
      cwd: process.cwd()
    })

    const got = await new Promise<string>((resolve) => {
      let buf = ''
      s.onData((d) => {
        buf += d
        if (buf.includes('PTY_DATA_MARKER')) resolve(buf)
      })
      s.start()
    })

    expect(got).toContain('PTY_DATA_MARKER')
    s.kill()
  })

  it('kill() sets state to exited and the pid is no longer alive', async () => {
    const s = new PtySession({
      worktreeId: 'wt-1',
      kind: 'shell',
      command: 'bash',
      args: ['-lc', 'sleep 30'],
      cwd: process.cwd()
    })
    s.start()
    expect(s.pid).toBeGreaterThan(0)
    expect(isAlive(s.pid)).toBe(true)

    const pid = s.pid
    await new Promise<void>((resolve) => {
      s.onExit(() => resolve())
      s.kill()
    })

    expect(s.state).toBe('exited')
    // give the OS a tick to reap
    await new Promise((r) => setTimeout(r, 50))
    expect(isAlive(pid)).toBe(false)
  })

  it('writes the bootstrap command into the pty after spawn', async () => {
    const s = new PtySession({
      worktreeId: 'wt-1',
      kind: 'agent',
      command: 'bash',
      cwd: process.cwd(),
      bootstrap: 'echo BOOT_MARKER\n'
    })
    const got = await new Promise<string>((resolve) => {
      let buf = ''
      s.onData((d) => {
        buf += d
        if (buf.includes('BOOT_MARKER')) resolve(buf)
      })
      s.start()
    })
    expect(got).toContain('BOOT_MARKER')
    s.kill()
  })

  it('resize() on a live session does not throw', () => {
    const s = new PtySession({
      worktreeId: 'wt-1',
      kind: 'shell',
      command: 'bash',
      args: ['-lc', 'sleep 30'],
      cwd: process.cwd()
    })
    s.start()
    expect(() => s.resize(120, 40)).not.toThrow()
    s.kill()
  })
})
