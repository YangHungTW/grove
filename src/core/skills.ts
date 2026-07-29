/** Agent Skills: discovery and launch-time invocation.
 *
 * No coding-agent CLI exposes a launch-time skill flag — verified against
 * Claude Code v2.1.220, where `--skill`/`--skills` are both `unknown option`,
 * and whose `--agents` JSON `skills:` field preloads only into a *subagent*
 * (it silently no-ops for the main session agent). The documented, working
 * mechanism is to invoke the skill from the first prompt, so that is what
 * Grove does: N invocation lines, then the user's task.
 *
 * Deliberately imports nothing. The renderer needs withSkills() to build a
 * launch command, so this file must stay free of Node builtins; discoverSkills
 * takes an injected reader instead (same trick as buildAgentLaunch's injected
 * `newId` in ./resume.ts). Paths are joined with '/' — Grove is Unix-only
 * (it launches agents through `$SHELL -ilc` and tmux).
 */

/** A skill Grove found on disk and can offer at launch. */
export interface SkillDef {
  /** Directory name. This IS the invocable name — NOT the frontmatter `name`,
   * which for personal/project skills is only documentation. */
  id: string
  /** Frontmatter `description`, or '' when absent/unparseable. UI hint only. */
  description: string
  /** Which root it came from; shown to disambiguate same-named skills. */
  source: 'personal' | 'project'
}

/** The filesystem operations discoverSkills needs. Both must swallow their own
 * errors: a missing skills directory is the normal case, not a failure. */
export interface SkillFs {
  /** Entry names directly under `dir`; [] when it does not exist. */
  readdir(dir: string): string[]
  /** File contents; '' when unreadable. */
  readFile(path: string): string
}

/** Leading token that invokes a skill for this agent's CLI.
 *
 * Claude Code (and, by default, anything else) uses `/name`; Codex uses
 * `$name`. Keyed off the command's first word rather than the agent id
 * because agents are user-editable — the same reasoning as supportsResume().
 * Unverified CLIs get `/` rather than a guess. */
export function skillToken(agentCommand: string): string {
  return agentCommand.trim().split(/\s+/)[0] === 'codex' ? '$' : '/'
}

/**
 * Prepend one invocation line per selected skill to the task prompt.
 *
 * An empty (or all-blank) selection returns `prompt` **unchanged** — byte for
 * byte, so a launch with no skills selected is indistinguishable from one
 * built before this feature existed. That is the "just ask the agent" default.
 *
 * Ids are de-duplicated: an invoked skill's body stays in the conversation for
 * the whole session, so loading one twice is pure wasted context.
 */
export function withSkills(
  prompt: string,
  skillIds: readonly string[] | undefined,
  agentCommand: string
): string {
  const ids = [...new Set((skillIds ?? []).map((s) => s.trim()).filter(Boolean))]
  if (!ids.length) return prompt
  const token = skillToken(agentCommand)
  return ids.map((id) => `${token}${id}`).join('\n') + '\n' + prompt
}

/** Read `description:` out of a SKILL.md YAML frontmatter block. Single-line
 * values only — this feeds a tooltip, so a folded/multi-line description
 * degrading to '' is acceptable. */
export function parseSkillDescription(md: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)
  if (!fm) return ''
  const line = /^description:[ \t]*(.*)$/m.exec(fm[1])
  if (!line) return ''
  return line[1].trim().replace(/^["']|["']$/g, '')
}

/** Parse the settings field's comma-separated skill list into ids. Tolerates
 * stray whitespace, empty entries and a trailing comma (all of which occur
 * mid-typing) and strips a leading `/` or `$` so pasting `/review` works. */
export function parseSkillList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim().replace(/^[/$]/, ''))
        .filter(Boolean)
    )
  ]
}

const SKILLS_SUBDIR = '.claude/skills'

/**
 * Enumerate skills under the personal (`<home>/.claude/skills`) and project
 * (`<repoRoot>/.claude/skills`) roots.
 *
 * Personal wins an id clash, matching the documented precedence. Sorted by id
 * so the picker's order is stable across calls.
 */
export function discoverSkills(
  fs: SkillFs,
  opts: { home?: string; repoRoot?: string }
): SkillDef[] {
  const found = new Map<string, SkillDef>()
  // Project first, so a personal skill of the same name overwrites it below.
  const roots: { dir: string; source: SkillDef['source'] }[] = [
    ...(opts.repoRoot ? [{ dir: `${opts.repoRoot}/${SKILLS_SUBDIR}`, source: 'project' as const }] : []),
    ...(opts.home ? [{ dir: `${opts.home}/${SKILLS_SUBDIR}`, source: 'personal' as const }] : [])
  ]
  for (const { dir, source } of roots) {
    for (const id of fs.readdir(dir)) {
      if (id.startsWith('.')) continue
      const md = fs.readFile(`${dir}/${id}/SKILL.md`)
      // No SKILL.md → not a skill directory (could be anything the user left there).
      if (!md) continue
      found.set(id, { id, description: parseSkillDescription(md), source })
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id))
}
