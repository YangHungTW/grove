import { describe, it, expect } from 'vitest'
import { parseUnifiedDiff, splitHunkRows, type DiffLine } from './diffParse'

const SAMPLE = `diff --git a/foo.txt b/foo.txt
index 1234567..89abcde 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,3 +1,3 @@
 context line
-old line
+new line
diff --git a/bar.txt b/bar.txt
new file mode 100644
--- /dev/null
+++ b/bar.txt
@@ -0,0 +1,1 @@
+brand new
`

describe('parseUnifiedDiff', () => {
  it('splits into files, hunks, and add/del/context lines', () => {
    const files = parseUnifiedDiff(SAMPLE)
    expect(files).toHaveLength(2)
    expect(files[0].newPath).toBe('foo.txt')

    const lines = files[0].hunks[0].lines
    expect(lines.some((l) => l.type === 'add' && l.text === 'new line')).toBe(true)
    expect(lines.some((l) => l.type === 'del' && l.text === 'old line')).toBe(true)
    expect(lines.some((l) => l.type === 'context' && l.text === 'context line')).toBe(true)
  })

  it('handles an added file (/dev/null old path)', () => {
    const files = parseUnifiedDiff(SAMPLE)
    expect(files[1].oldPath).toBe('/dev/null')
    expect(files[1].newPath).toBe('bar.txt')
    expect(files[1].hunks[0].lines).toEqual([{ type: 'add', text: 'brand new' }])
  })

  it('returns an empty array for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('decodes git-quoted (octal-escaped) non-ASCII paths', () => {
    const cjk =
      'diff --git "a/\\344\\270\\255.txt" "b/\\344\\270\\255.txt"\n' +
      'index 1..2 100644\n' +
      '--- "a/\\344\\270\\255.txt"\n' +
      '+++ "b/\\344\\270\\255.txt"\n' +
      '@@ -1 +1 @@\n' +
      '-a\n' +
      '+b\n'
    const [f] = parseUnifiedDiff(cjk)
    expect(f.oldPath).toBe('中.txt')
    expect(f.newPath).toBe('中.txt')
  })

  it('names a binary file from a git-quoted header', () => {
    const bin =
      'diff --git "a/\\345\\234\\226.png" "b/\\345\\234\\226.png"\n' +
      'Binary files "a/\\345\\234\\226.png" and "b/\\345\\234\\226.png" differ\n'
    const [f] = parseUnifiedDiff(bin)
    expect(f.newPath).toBe('圖.png')
    expect(f.binary).toBe(true)
  })

  it('names binary files from the header and flags them (no phantom +0/−0)', () => {
    const bin = `diff --git a/e2e/smoke.png b/e2e/smoke.png
index ea717e4..5187f0f 100644
Binary files a/e2e/smoke.png and b/e2e/smoke.png differ
`
    const [f] = parseUnifiedDiff(bin)
    expect(f.newPath).toBe('e2e/smoke.png')
    expect(f.binary).toBe(true)
    expect(f.hunks).toEqual([])
  })
})

describe('splitHunkRows', () => {
  const ctx = (text: string): DiffLine => ({ type: 'context', text })
  const add = (text: string): DiffLine => ({ type: 'add', text })
  const del = (text: string): DiffLine => ({ type: 'del', text })

  it('mirrors context into both columns', () => {
    const rows = splitHunkRows([ctx('a'), ctx('b')])
    expect(rows).toEqual([
      { left: ctx('a'), right: ctx('a') },
      { left: ctx('b'), right: ctx('b') }
    ])
  })

  it('pairs a del run with the add run that follows it', () => {
    const rows = splitHunkRows([del('old1'), del('old2'), add('new1'), add('new2')])
    expect(rows).toEqual([
      { left: del('old1'), right: add('new1') },
      { left: del('old2'), right: add('new2') }
    ])
  })

  it('leaves the other cell empty for unbalanced runs and pure insertions', () => {
    expect(splitHunkRows([del('a'), add('x'), add('y')])).toEqual([
      { left: del('a'), right: add('x') },
      { left: null, right: add('y') }
    ])
    expect(splitHunkRows([add('only-new')])).toEqual([{ left: null, right: add('only-new') }])
    expect(splitHunkRows([del('only-old')])).toEqual([{ left: del('only-old'), right: null }])
  })

  it('keeps separate change runs separated by context apart', () => {
    const rows = splitHunkRows([del('a'), add('b'), ctx('mid'), add('c')])
    expect(rows).toEqual([
      { left: del('a'), right: add('b') },
      { left: ctx('mid'), right: ctx('mid') },
      { left: null, right: add('c') }
    ])
  })
})
