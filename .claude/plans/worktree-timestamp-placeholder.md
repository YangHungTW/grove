---
slug: worktree-timestamp-placeholder
created_at: 2026-06-10T13:40:17Z
discipline: normal
orchestration: single
team_size: 3
time_budget: 25 turns
depends_on: []
status: done
started_at: 2026-06-10T14:05:02Z
finished_at: 2026-06-10T14:19:12Z
executor: main
---

# Goal
Add a `{timestamp}` placeholder to the worktree folder template (alongside `{repo}` and `{branch}`) so new worktrees can carry a filesystem-safe datetime in their path.

# Acceptance Criteria
<!-- machine-parsed by /yang-toolkit:execute-plan. Each item MUST follow:
- [ ] **<short name>**
  - Check: `<runnable command in backticks>`
  - Pass: <observable condition; no fuzzy words>
-->

- [ ] **{timestamp} expands to a filesystem-safe datetime**
  - Check: `npm test`
  - Pass: vitest exits 0 and a new test asserts a pure expander (e.g. `expandWorktreeTemplate("../{repo}-wt-{branch}-{timestamp}", {repo:"r", branch:"b", now: <fixed Date>})`) returns a string whose `{timestamp}` segment matches `/^\d{8}-\d{6}$/` and contains no `/`, `:`, or space characters.

- [ ] **Settings panel documents the placeholder**
  - Check: `grep -F "{timestamp}" src/renderer/SettingsPanel.tsx`
  - Pass: grep exits 0 (the "Placeholders:" hint at src/renderer/SettingsPanel.tsx:221 lists `{timestamp}`).

- [ ] **No regressions in existing worktree-path resolution**
  - Check: `npm run typecheck`
  - Pass: `tsc` exits 0; `resolveWorktreePath` (src/main/index.ts:95) delegates to the pure expander and still expands `{repo}`/`{branch}` as before.

# Files Touched
- src/main/index.ts (resolveWorktreePath delegates to the pure expander)
- src/core/worktree.ts (new pure `expandWorktreeTemplate`) + src/core/worktree.test.ts
- src/core/settings.ts (doc comment at line 114 lists `{timestamp}`)
- src/renderer/SettingsPanel.tsx (placeholders hint at line 221)

# Out of Scope
- Adding `{timestamp}` to the per-project create/remove hook placeholders (`{worktree}`/`{branch}`/`{repo}` at runHook, src/main/index.ts:108) — folder template only.
- Configurable timestamp format (a single fixed `YYYYMMDD-HHMMSS` format is the deliverable).
- Changing the default `worktreeFolder` template value.

# Risks
- `resolveWorktreePath` is currently impure-friendly but untested; introducing a pure `expandWorktreeTemplate(tmpl, {repo, branch, now})` is what makes `{timestamp}` deterministically testable. Keep `resolveWorktreePath` as the thin Date-supplying wrapper.
- Timestamp must be filesystem-safe: no `:` (breaks paths on some FS), no spaces, no `/`. `YYYYMMDD-HHMMSS` avoids all three. The existing `safeBranch` sanitization (src/main/index.ts:97) should not be applied to an already-safe timestamp (don't double-mangle).
- Two worktrees created in the same second with an otherwise-identical template would collide; acceptable given `{branch}` is normally also present, but note it.

# Memory References
<!-- auto-generated below; remove individual lines if irrelevant.
Lines without <!--auto--> are preserved on --revise.
<type> is one of: ledger | decision | claude-md | plan | pattern | external.
For [external], <path> is a URL. -->

- <!--auto--> [pattern] src/main/index.ts:95 -- `resolveWorktreePath` does the `{repo}`/`{branch}` replace today; extract the string work into a pure core function and add `{timestamp}`.
- <!--auto--> [pattern] src/renderer/SettingsPanel.tsx:221 -- the `<small>Placeholders: {repo}, {branch}</small>` hint is the one UI string to update.
- <!--auto--> [pattern] src/core/settings.ts:114 -- the `worktreeFolder` doc comment enumerates supported placeholders; keep it in sync.
- <!--auto--> [ledger] .claude/ledger.jsonl (2026-06-09T06:05Z) -- the original worktree-folder-template + hooks work that introduced `resolveWorktreePath` and the `{repo}`/`{branch}` placeholders.
- <!--auto--> [pattern] src/core/worktree.test.ts -- existing temp-repo vitest pattern to mirror for the expander test.

# Execution Log
<!-- filled by /yang-toolkit:execute-plan post-hoc. Leave empty in draft. -->

## Run 1 — 2026-06-10
- **started_at:** 2026-06-10T14:05:02Z
- **finished_at:** 2026-06-10T14:19:12Z (~14 min)
- **outcome:** done
- **orchestration:** single (normal discipline; implemented directly toward the /goal condition)
- **goal evaluator:** all three acceptance criteria satisfied — `npm run vitest run` 65/65 pass (new `expandWorktreeTemplate` tests assert `{timestamp}` → `/^\d{8}-\d{6}$/` with no `/ : space`, and branch sanitization); `grep -F "{timestamp}" src/renderer/SettingsPanel.tsx` exit 0; `npm run typecheck` exit 0 with `resolveWorktreePath` delegating to the pure expander.
- **turns:** ~6 (orchestrator-direct, no downstream /goal loop spawned for this trivial change)
- **approx tokens:** small (single-session implementation)
- **scope:** clean — only the 5 Files Touched modified (`git status` outside `.claude/` shows exactly settings.ts, worktree.ts, worktree.test.ts, main/index.ts, SettingsPanel.tsx). Out-of-scope respected: hook placeholders untouched, format fixed at `YYYYMMDD-HHMMSS`, default template value unchanged.
- **implementation:** added pure `expandWorktreeTemplate(tmpl, {repo, branch, now})` + `formatTimestamp` to `src/core/worktree.ts`; `resolveWorktreePath` now passes `new Date()` into it.
