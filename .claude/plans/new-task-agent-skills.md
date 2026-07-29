---
slug: new-task-agent-skills
created_at: 2026-07-29T10:34:21Z
discipline: normal
orchestration: single
team_size: 3
time_budget: 25 turns
depends_on: []
status: done
started_at: 2026-07-29T11:10:00Z
finished_at: 2026-07-29T11:21:38Z
executor: main
---

# Goal
Let each agent carry a set of default Agent Skills that pre-seed (and can be
overridden in) the New Task dialog, injected as `/skill-name` lines ahead of the
task prompt — with an empty selection injecting nothing, so the agent behaves
exactly as it does today.

# Acceptance Criteria

- [ ] **Skill discovery and prompt composition are unit-tested pure functions**
  - Check: `npx vitest run src/core/skills.test.ts`
  - Pass: exits 0, and the file contains (a) a test asserting `withSkills(p, [], cmd)` returns a string `===` to `p`, (b) a test asserting `withSkills('do it', ['a','b'], 'claude')` returns a string starting with `/a\n/b\n` and ending with `do it`, and (c) a discovery test that seeds `<home>/.claude/skills/foo/SKILL.md` and `<repo>/.claude/skills/bar/SKILL.md` in a tmpdir and asserts the returned ids are exactly `['bar','foo']` with `description` read from each file's frontmatter.

- [ ] **New Task passes the selection through to the launched pty command**
  - Check: `npx vitest run src/renderer/store.test.ts -t startTask`
  - Pass: exits 0, and `describe('startTask (New task flow)')` contains (a) a test where a call with `['foo']` yields a `sessionCreate` request whose `command` contains `/foo` at a lower string index than the task text, and (b) a test where a call with `[]` yields a `command` string equal to the value asserted by the pre-existing no-skills test.

- [ ] **Per-agent default skills survive a settings round-trip**
  - Check: `npx vitest run src/core/settingsStore.test.ts`
  - Pass: exits 0, and the file contains a test that `save()`s an agent entry with `skills: ['x']`, calls `load()` against the same tmpdir path, and asserts the reloaded entry's `skills` equals `['x']`; plus a test that an agent entry persisted without a `skills` key reloads with `skills === undefined` and no thrown error.

- [ ] **The skills IPC channel exists in all three layers**
  - Check: `grep -l skillsAvailable src/main/ipc.ts src/preload/index.ts src/main/index.ts`
  - Pass: the command exits 0 and prints all three paths.

- [ ] **Full verification suite is green**
  - Check: `npm run typecheck && npx vitest run && npm run e2e`
  - Pass: exits 0.

# Files Touched
- `src/core/skills.ts` (new — discovery + `withSkills` composition + per-agent invocation token)
- `src/core/skills.test.ts` (new)
- `src/core/settings.ts` (`AgentDef.skills?: string[]`, `AGENT_PRESETS` untouched)
- `src/core/settingsStore.test.ts`
- `src/main/ipc.ts` (`Channels.skillsAvailable` + `RendererApi`)
- `src/preload/index.ts`
- `src/main/index.ts` (handler mirroring `resolveAgents()` / `agents:available`)
- `src/renderer/store.ts` (`startTask` gains a skills argument; composes the prompt before `addSession`)
- `src/renderer/store.test.ts`
- `src/renderer/Dialog.tsx` (skills checkbox group in the New Task form)
- `src/renderer/SettingsPanel.tsx` (default-skills field on each agent row)
- `src/renderer/styles.css` (only if the checkbox group needs a rule beyond `.dialog-check`)

# Out of Scope
- Plain (non-New-Task) agent session launches. Those have no initial prompt to
  prepend to, so per-agent defaults do not apply there; revisit separately.
- Worktree create/remove hooks (`agy -p "/onboard"`) — an adjacent but separate
  skill-invocation mechanism, left alone.
- `--agents` / `--agent` session profiles, `--append-system-prompt`, and any
  settings-file-based skill gating (`skillOverrides`, `disableBundledSkills`).
- Reading or writing anything under `~/.claude/skills/` or `.claude/skills/`;
  discovery is read-only enumeration.
- Codex `.agents/skills/` discovery and the `$skill` invocation token beyond a
  single documented default-vs-`codex` branch in `skillInvocation`.
- Plugin-namespaced skills (`/plugin:skill`) discovery — see Risks.

# Risks
- **There is no `--skill`/`--skills` CLI flag.** Verified against Claude Code
  v2.1.220: both return `unknown option`. The feature must be built as prompt
  composition. A later "cleanup" that converts this to a flag will break every
  launch.
- **The `--agents` JSON `skills:` preload field is subagent-only** and silently
  no-ops for the main session agent (verified by experiment). Do not reach for it
  as a shortcut.
- **Double shell-quoting.** The prompt is shell-quoted by `src/core/shellQuote.ts`
  into `withInitialPrompt`, and in durable mode `src/core/tmuxLaunch.ts:52-64`
  re-wraps the whole command in `sh -ilc '…'`. A multi-line prompt now carries
  literal newlines through both layers. The `tmux-session-persistence` plan
  already recorded escaping bugs that only showed up at the second layer — test
  the durable path, not just the direct one.
- **Main-process allowlist.** `src/main/index.ts:288-300` requires the command to
  equal a configured agent command or start with `<cmd> `. Skill content must be
  appended (inside the prompt), never prepended to the command.
- **`CCM_AGENT_CMD` short-circuits `launchSpecFor`**, so `npm run e2e` cannot
  exercise real skill loading — e2e can only assert the assembled command string.
- **e2e selector fragility.** `e2e/smoke.mjs:336-363` grabs the *first*
  `.dialog-field input`. Render the skills control as `.dialog-check` checkboxes
  (mirroring the agent radios) rather than a `.dialog-field input`, or the New
  Task leg breaks.
- **Invocation token differs per CLI**: `/name` for Claude Code, `$name` for
  Codex (which also uses `.agents/skills/`). Antigravity is unverified — default
  to `/` and branch only where verified.
- **Context cost is real.** An invoked skill's body enters the conversation as a
  message and stays for the whole session; pre-selecting several large skills is
  not a free toggle.
- **Silent failure.** Claude Code skips a missing or disabled skill with only a
  debug-log warning, so a typo'd per-agent default produces no visible error in
  Grove. Consider surfacing unknown ids in the dialog.
- **Plugin skills are invisible to globbing.** `/yang-toolkit:dashboard`-style
  skills do not live under `~/.claude/skills/*/SKILL.md`. Either accept free-text
  entry for defaults or accept that the picker lists local skills only.
- **No prior design record.** The New Task flow shipped in commit `d2ae1fa`
  (2026-07-09) with no plan file and no ledger entry — source is the only
  reference for how it works.

# Memory References
<!-- auto-generated below; remove individual lines if irrelevant.
Lines without <!--auto--> are preserved on --revise.
<type> is one of: ledger | decision | claude-md | plan | pattern | external.
For [external], <path> is a URL. -->

- <!--auto--> [pattern] `src/core/resume.ts:9-40` -- `supportsResume()` + `buildAgentLaunch()`: the exact template for a capability-gated, per-agent launch modifier.
- <!--auto--> [pattern] `src/core/newTask.ts:14-18` -- `withInitialPrompt()`; its empty-prompt guard is the model for "no skills selected → return the command unchanged".
- <!--auto--> [pattern] `src/renderer/Dialog.tsx:443-454` -- the New Task agent radio group (`.dialog-check`, hidden when ≤1 option); mirror it as checkboxes for skills.
- <!--auto--> [pattern] `src/renderer/store.test.ts:110-145` -- `describe('startTask (New task flow)')` with the `window.api` stub capturing `sessionCreate`; the test to extend.
- <!--auto--> [pattern] `src/core/settings.ts:5-15,119-204` + `src/core/settingsStore.ts:17-42` -- `AgentDef` shape, `DEFAULT_SETTINGS`, and the ad-hoc (unversioned) migration style for a new persisted field.
- <!--auto--> [pattern] `src/main/index.ts:147-150` -- `resolveAgents()` / `agents:available`; the handler shape a `skills:available` channel should copy.
- <!--auto--> [claude-md] `CLAUDE.md:19` -- `CCM_AGENT_CMD` stands in for a real agent CLI in e2e, so e2e cannot verify real skill loading.
- <!--auto--> [claude-md] `CLAUDE.md` (IPC section) -- a channel must be added to `src/main/ipc.ts`, `src/preload/index.ts`, and `window.api` in lock-step.
- <!--auto--> [ledger] `2026-06-17 new-agent-shortcut-shell-shift-enter` (merged) -- agent-chooser menu state lifted into the store, autofocus + Escape; the UI a skill picker sits beside.
- <!--auto--> [ledger] `2026-06-09 single-worktree-multi-session` (in-progress, plan `status: done`) -- introduced the user-editable `settings.agents` rows where a default-skills field belongs.
- <!--auto--> [ledger] `2026-06-09 single-worktree-multi-session` (in-progress) -- `AGENT_PRESETS` + the "hide at 0 / direct at 1 / menu at many" selector rule a skills control should respect.
- <!--auto--> [plan] `.claude/plans/tmux-session-persistence.md` (done) -- durable sessions add a second quoting layer; its Execution Log records escaping bugs that only surfaced there.
- <!--auto--> [plan] `.claude/plans/single-worktree-multi-session.md` (done) -- "agent CLIs change their output" materialised repeatedly (gemini-cli → antigravity churn); avoid hard-coding CLI behaviour.
- <!--auto--> [decision] `docs/decisions/2026-06-08-single-worktree-multi-session/08-agent-cli.md` -- why agents launch under `$SHELL -ilc` (so aliases and `--plugin-dir` expand and user plugins/skills are not dropped).
- <!--auto--> [external] https://code.claude.com/docs/en/cli-reference -- no `--skill`/`--skills` flag and no `claude skills` subcommand exist; `--disallowed-tools "Skill"` and `--safe-mode` are the only skill-related switches.
- <!--auto--> [external] https://code.claude.com/docs/en/skills -- invocable name comes from the *directory* name; plugin skills are `/plugin:skill`; an invoked skill's body persists for the whole session.
- <!--auto--> [external] https://code.claude.com/docs/en/sub-agents -- `--agents` JSON `skills:` preloads only into a *subagent*; `initialPrompt` is what processes commands and skills for the main session agent.
- <!--auto--> [external] https://code.claude.com/docs/en/agent-sdk/skills -- the stream-json `init` message carries a `skills` array (user-invocable only) — an alternative to globbing, at the cost of one model turn.
- <!--auto--> [external] https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/ -- SKILL.md is a cross-vendor standard, but Codex uses `.agents/skills/` and `$skill-name`; no launch-time flag there either.

# Execution Log
<!-- filled by /yang-toolkit:execute-plan post-hoc. Leave empty in draft. -->

## Run 1 — 2026-07-29

- **started_at** 2026-07-29T11:10:00Z · **finished_at** 2026-07-29T11:21:38Z · **duration** ~12 min
- **outcome** done
- **orchestration** single · **discipline** normal · downstream:
  `/yang-toolkit:feature-dev-tracked`
- **decision docs** `docs/decisions/2026-07-29-new-task-agent-skills/` (5 phases)

### Acceptance criteria

| # | Criterion | Check | Result |
| - | --------- | ----- | ------ |
| 1 | Skill discovery + prompt composition unit-tested | `npx vitest run src/core/skills.test.ts` | PASS (15 tests) |
| 2 | New Task passes selection to the pty command | `npx vitest run src/renderer/store.test.ts -t startTask` | PASS |
| 3 | Per-agent defaults survive a settings round-trip | `npx vitest run src/core/settingsStore.test.ts` | PASS (11 tests) |
| 4 | Skills IPC channel in all three layers | `grep -l skillsAvailable …` | PASS (3/3 paths) |
| 5 | Full verification suite green | `npm run typecheck && npx vitest run && npm run e2e` | PASS (283 tests, `SMOKE_OK newTask=true`) |

### Scope-guard result — ONE violation

`src/core/settingsStore.ts` was modified although it is not in Files Touched.

Criterion 3 failed on first run: `skills` vanished across save/load. Cause was a
pre-existing heuristic (`settingsStore.ts:23-24`) that treats any single-agent
array of `{id:'claude', command:'claude'}` as the legacy auto-created default
and replaces it wholesale with the presets — silently discarding default skills
on every load for the commonest configuration. The feature would have appeared
to work until the next restart.

Minimal fix applied (the legacy check now also requires no skills set);
behaviour is unchanged for any settings file that does not use skills. The
wider bug in that heuristic — it also clobbers a renamed or re-iconed lone
Claude entry — is unrelated and was left alone.

No other file outside Files Touched was touched. `src/renderer/styles.css` and
all other modified files are on the list.

### Notes

- `/goal` was unavailable in this session (not exposed as a tool or skill), so
  the criteria loop was driven manually — effectively a `--no-goal` run. Each
  criterion's Check was executed individually and is recorded above.
- `--auto` was requested; auto mode could not be enabled programmatically, and
  the user confirmed they had enabled it themselves before execution began.
- Review phase caught two defects in the new code (dialog hard-coded `/` as the
  invocation token even for codex; fabricated `source` on not-found skills),
  both fixed before the final verification run.
- Not covered by any test: that a real agent honours the injected `/name` line.
  `CCM_AGENT_CMD` replaces the agent binary in e2e.
