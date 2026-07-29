import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  discoverSkills,
  parseSkillDescription,
  parseSkillList,
  skillToken,
  withSkills,
  type SkillFs
} from './skills.js'

/** The adapter src/main/index.ts installs, mirrored here so the discovery
 * tests run against real files on disk rather than a hand-built fake. */
const nodeSkillFs: SkillFs = {
  readdir(dir) {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  },
  readFile(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return ''
    }
  }
}

describe('withSkills — prompt composition', () => {
  it('returns the prompt byte-identical when nothing is selected', () => {
    const p = 'Fix the flaky login test'
    // The whole "no skills configured → just ask the agent" contract: the
    // launch command must be indistinguishable from a pre-feature one.
    expect(withSkills(p, [], 'claude')).toBe(p)
    expect(withSkills(p, undefined, 'claude')).toBe(p)
    expect(withSkills(p, ['', '  '], 'claude')).toBe(p)
  })

  it('prepends one invocation line per skill, task text last', () => {
    const out = withSkills('do it', ['a', 'b'], 'claude')
    expect(out.startsWith('/a\n/b\n')).toBe(true)
    expect(out.endsWith('do it')).toBe(true)
    expect(out).toBe('/a\n/b\ndo it')
  })

  it('de-duplicates ids (a skill body persists all session; loading it twice is waste)', () => {
    expect(withSkills('go', ['a', 'a', 'b', 'a'], 'claude')).toBe('/a\n/b\ngo')
  })

  it('uses the CLI’s own invocation token', () => {
    expect(withSkills('go', ['x'], 'codex')).toBe('$x\ngo')
    expect(withSkills('go', ['x'], 'claude --dangerously-skip-permissions')).toBe('/x\ngo')
  })

  it('keeps a multi-line task prompt intact below the skill lines', () => {
    expect(withSkills('line1\nline2', ['s'], 'claude')).toBe('/s\nline1\nline2')
  })
})

describe('skillToken', () => {
  it('is $ for codex and / for everything else, keyed on the first word', () => {
    expect(skillToken('codex')).toBe('$')
    expect(skillToken('  codex --full-auto ')).toBe('$')
    expect(skillToken('claude')).toBe('/')
    // Unverified CLIs take the documented-majority default rather than a guess.
    expect(skillToken('agy')).toBe('/')
    expect(skillToken('')).toBe('/')
  })
})

describe('parseSkillDescription', () => {
  it('reads a single-line frontmatter description, unquoted', () => {
    expect(parseSkillDescription('---\nname: x\ndescription: Does a thing\n---\nbody')).toBe(
      'Does a thing'
    )
    expect(parseSkillDescription('---\ndescription: "Quoted"\n---\n')).toBe('Quoted')
    expect(parseSkillDescription("---\ndescription: 'Quoted'\n---\n")).toBe('Quoted')
  })

  it('returns empty string when there is no frontmatter or no description', () => {
    expect(parseSkillDescription('# Just a heading')).toBe('')
    expect(parseSkillDescription('---\nname: x\n---\nbody')).toBe('')
    expect(parseSkillDescription('')).toBe('')
  })

  it('does not pick up a description line from the body', () => {
    expect(parseSkillDescription('---\nname: x\n---\ndescription: not frontmatter')).toBe('')
  })
})

describe('parseSkillList', () => {
  it('splits, trims, drops blanks and de-dupes', () => {
    expect(parseSkillList('a, b ,, c,')).toEqual(['a', 'b', 'c'])
    expect(parseSkillList('a, a')).toEqual(['a'])
    expect(parseSkillList('   ')).toEqual([])
    expect(parseSkillList('')).toEqual([])
  })

  it('strips a pasted invocation prefix', () => {
    expect(parseSkillList('/review, $deploy')).toEqual(['review', 'deploy'])
  })
})

describe('discoverSkills', () => {
  let root = ''
  const home = (): string => join(root, 'home')
  const repo = (): string => join(root, 'repo')
  const seed = (base: string, id: string, body: string): void => {
    mkdirSync(join(base, '.claude', 'skills', id), { recursive: true })
    writeFileSync(join(base, '.claude', 'skills', id, 'SKILL.md'), body)
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'grove-skills-'))
    seed(home(), 'foo', '---\nname: foo\ndescription: Personal foo\n---\n')
    seed(repo(), 'bar', '---\nname: bar\ndescription: Project bar\n---\n')
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('finds skills in both roots, sorted by id, with parsed descriptions', () => {
    const found = discoverSkills(nodeSkillFs, { home: home(), repoRoot: repo() })
    expect(found.map((s) => s.id)).toEqual(['bar', 'foo'])
    expect(found.map((s) => s.description)).toEqual(['Project bar', 'Personal foo'])
    expect(found.map((s) => s.source)).toEqual(['project', 'personal'])
  })

  it('returns [] for absent roots instead of throwing', () => {
    expect(discoverSkills(nodeSkillFs, { home: join(root, 'nope') })).toEqual([])
    expect(discoverSkills(nodeSkillFs, {})).toEqual([])
  })

  it('ignores directories without a SKILL.md, and dotfiles', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'grove-skills-x-'))
    mkdirSync(join(scratch, '.claude', 'skills', 'notaskill'), { recursive: true })
    seed(scratch, '.hidden', '---\ndescription: d\n---\n')
    seed(scratch, 'real', '---\ndescription: d\n---\n')

    expect(discoverSkills(nodeSkillFs, { repoRoot: scratch }).map((s) => s.id)).toEqual(['real'])
    rmSync(scratch, { recursive: true, force: true })
  })

  it('lets a personal skill win an id clash with a project one', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'grove-skills-c-'))
    const h = join(scratch, 'h')
    const r = join(scratch, 'r')
    seed(h, 'dup', '---\ndescription: from personal\n---\n')
    seed(r, 'dup', '---\ndescription: from project\n---\n')

    const found = discoverSkills(nodeSkillFs, { home: h, repoRoot: r })
    expect(found).toHaveLength(1)
    expect(found[0].description).toBe('from personal')
    expect(found[0].source).toBe('personal')
    rmSync(scratch, { recursive: true, force: true })
  })
})
