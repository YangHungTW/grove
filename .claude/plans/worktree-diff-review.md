---
slug: worktree-diff-review
created_at: 2026-06-10T13:40:17Z
discipline: normal
orchestration: single
team_size: 3
time_budget: 25 turns
depends_on: []
status: done
started_at: 2026-06-10T14:42:56Z
finished_at: 2026-06-10T14:49:37Z
executor: main
---

# Goal
Let a user review what a worktree changed — open a git diff of the worktree's changes in a "diff" pane, rendered as a hand-styled unified diff.

# Acceptance Criteria
<!-- machine-parsed by /yang-toolkit:execute-plan. Each item MUST follow:
- [ ] **<short name>**
  - Check: `<runnable command in backticks>`
  - Pass: <observable condition; no fuzzy words>
-->

- [ ] **Unified diff parses into files, hunks, and typed lines**
  - Check: `npm test`
  - Pass: vitest exits 0 and a new test in `src/renderer/diffParse.test.ts` parses a sample unified-diff string into an array of files, each with hunks, and asserts at least one line typed `add` (prefix `+`), one `del` (prefix `-`), and one `context`.

- [ ] **worktreeDiff returns a worktree's changes**
  - Check: `npm test`
  - Pass: vitest exits 0 and a new test in `src/core/worktree.test.ts` builds a temp git repo, modifies a tracked file, and asserts `worktreeDiff(path)` output contains the new line prefixed with `+` and the file's path.

- [ ] **A worktree with changes shows a diff pane in the app**
  - Check: `npm run e2e`
  - Pass: e2e exits 0; the smoke probe creates a worktree, writes a change in it, triggers the review action (via the store action / `window.api` so no native dialog), and asserts `.pane[data-kind="diff"]` count ≥ 1 containing at least one element styled as an added line and one as a removed line.

# Files Touched
- src/core/worktree.ts + src/core/worktree.test.ts
- src/core/types.ts
- src/main/ipc.ts
- src/main/index.ts
- src/preload/index.ts
- src/renderer/store.ts
- src/renderer/PaneGrid.tsx
- src/renderer/DiffPane.tsx (new)
- src/renderer/diffParse.ts (new) + src/renderer/diffParse.test.ts (new)
- src/renderer/Sidebar.tsx
- src/renderer/Icons.tsx
- src/renderer/styles.css
- e2e/smoke.mjs

# Out of Scope
- Inline comments / approvals / any review-workflow state (display-only).
- Committing, staging, or reverting hunks from the diff view.
- Side-by-side (split) diff layout — unified view only.
- Diffing arbitrary ref ranges via UI; the base ref is computed/defaulted in code (a refresh button is fine, a ref picker is not).

# Risks
- Choosing the right base for "what this worktree changed" is the crux: working-tree-vs-HEAD misses committed branch work; HEAD-vs-default-branch misses uncommitted edits. Plan to combine committed-vs-base (merge-base with the repo's default branch) plus uncommitted (`git diff` + `git diff --staged`), and pin the behavior with the temp-repo test so the choice is explicit, not accidental.
- Shares the non-terminal pane scaffold (kind-aware `PaneGrid`, pty-skip in `createSession`, `SessionKind` extension) with `open-html-markdown-files`. If that plan has not landed, this plan must create the scaffold itself — running the file-viewer plan first avoids duplicate/conflicting scaffold edits. (consider adding `open-html-markdown-files` to `depends_on`.)
- `git()` in worktree.ts is synchronous `execFileSync`; a very large diff blocks the main process. Cap or stream if diffs get huge (note the cap in code rather than truncating silently).
- Rendering parsed diff text into the DOM must HTML-escape line content — a `+` line containing `<script>` would otherwise inject. The hand-rolled renderer is responsible for escaping (no `marked`/DOMPurify here).

# Memory References
<!-- auto-generated below; remove individual lines if irrelevant.
Lines without <!--auto--> are preserved on --revise.
<type> is one of: ledger | decision | claude-md | plan | pattern | external.
For [external], <path> is a URL. -->

- <!--auto--> [pattern] src/core/worktree.ts:22 -- `git(repoRoot, args)` = synchronous `execFileSync('git', args, {cwd})`; mirror it for `worktreeDiff(path, baseRef?)` alongside the existing `worktreeStatus()`.
- <!--auto--> [pattern] src/main/ipc.ts:10 -- add a `worktree:diff` channel + `RendererApi.worktreeDiff` method following the `worktree:status` handler shape (src/main/index.ts:291).
- <!--auto--> [pattern] src/renderer/Sidebar.tsx:84 -- `WorktreeCard` already shows dirty/ahead/behind indicators; add a "Review changes" button here that calls a new store action.
- <!--auto--> [pattern] src/renderer/PaneGrid.tsx:88 -- kind-aware pane branch (shared with the file-viewer plan): render `<DiffPane>` for `kind === 'diff'`.
- <!--auto--> [plan] .claude/plans/open-html-markdown-files.md -- sibling plan that introduces the same non-terminal pane scaffold; land it first to avoid duplicating the scaffold here.
- <!--auto--> [ledger] .claude/ledger.jsonl (2026-06-09T06:05Z) -- worktree create/remove + status already wired through main; `worktreeStatus` is the closest existing git-read to copy.
- <!--auto--> [decision] docs/decisions/2026-06-08-single-worktree-multi-session -- worktree model + per-project store this builds on.

# Execution Log
<!-- filled by /yang-toolkit:execute-plan post-hoc. Leave empty in draft. -->

## Run 1 — 2026-06-10
- **started_at:** 2026-06-10T14:42:56Z
- **finished_at:** 2026-06-10T14:49:37Z (~7 min)
- **outcome:** done
- **orchestration:** single (normal discipline; implemented directly toward the /goal condition). Reused the non-terminal pane scaffold from `open-html-markdown-files`, which had just landed — no duplicate scaffold.
- **goal evaluator:** all three acceptance criteria satisfied:
  - C1 `npx vitest run` → exit 0, 72/72 (new `diffParse.test.ts`: files/hunks split + add/del/context line typing, /dev/null added-file, empty input).
  - C2 `npx vitest run` → `worktree.test.ts`: `worktreeDiff` on a modified tracked file contains the path, `+# changed line`, `-# temp`; empty for a clean worktree.
  - C3 `npm run e2e` → exit 0; `SMOKE_OK … diffReview=true diffAdd=2 diffDel=1` (made a committed + uncommitted change in the feat worktree, opened the review pane from its sidebar card, asserted `.diff-line-add` and `.diff-line-del`).
- **base-ref choice (the crux):** `worktreeDiff` = committed `git diff <base>..HEAD` (base = merge-base with `origin/HEAD`, else `main`/`master`) PLUS uncommitted `git diff HEAD`. Pinned by the temp-repo test. Untracked files are not included.
- **implementation:** `worktreeDiff` in core/worktree.ts; pure `diffParse.ts` (unified-diff → files/hunks/typed lines, HTML-escaped at render); `DiffPane.tsx` (hand-styled diff + Refresh); IPC `worktree:diff`; store `reviewWorktreeChanges` + shared `placePane` helper (also refactored `openFile` onto it); Sidebar "Review changes" button (`DiffIcon`); SessionKind += `'diff'`, non-pty early-return generalized to viewer|diff; diff panes excluded from persistence.
- **scope:** this plan's new/modified files match the declared Files Touched exactly. The only extra working-tree change is `e2e/smoke.png` (screenshot artifact). Other modified files in `git status` (`package.json`, `Dialog.tsx`, `markdown.*`, `settings.ts`, etc.) belong to the two earlier, still-uncommitted plans — not this run.
