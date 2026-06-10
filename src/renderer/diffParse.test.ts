import { describe, it, expect } from 'vitest'
import { parseUnifiedDiff } from './diffParse'

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
