---
slug: changes-syntax-highlight-open-in-ide
created_at: 2026-06-17T01:07:26Z
discipline: normal
orchestration: single
team_size: 3
time_budget: 25 turns
depends_on: []
status: done
started_at: 2026-06-17T01:35:25Z
finished_at: 2026-06-17T01:48:10Z
executor: main
---

# Goal
Add per-language syntax highlighting to the changes/diff view and a per-file "open whole file in IDE" action that is disabled until an IDE is configured, launches GUI editors via their CLI, and routes terminal editors (e.g. vim) into an in-app shell session.

# Acceptance Criteria
<!-- machine-parsed by /yang-toolkit:execute-plan. -->

- [ ] **Diff lines are syntax-highlighted and stay HTML-escaped**
  - Check: `npx vitest run src/renderer/diffHighlight.test.ts`
  - Pass: Highlighting a TypeScript line `const x = 1` returns a string containing at least one `class="hljs-` span AND the original characters survive; highlighting a line containing `<script>alert(1)</script>` returns a string that contains `&lt;script&gt;` and contains NO literal substring `<script>` (escaping preserved, no XSS regression). Unknown/empty languages fall back to escaped plain text (no thrown error).

- [ ] **Open-in-IDE control is disabled when no IDE is configured**
  - Check: `npx vitest run src/core/ideLaunch.test.ts`
  - Pass: `canOpenInIde(settings)` returns `false` when `settings.ide` is undefined or its `command` is empty, and `true` when `settings.ide.command` is a non-empty string.

- [ ] **GUI editor launch invokes the configured command on the target file**
  - Check: `npm run e2e`
  - Pass: With env `CCM_IDE_CMD` pointing at a stub script (mirroring the existing `CCM_AGENT_CMD` pattern), triggering "open in IDE" on a changed file in the diff view runs the stub and the smoke test observes the stub's side effect (a marker file written with the target file path as an argument).

- [ ] **Terminal editor (vim) opens an in-app shell session running the editor on the file**
  - Check: `npx vitest run src/core/ideLaunch.test.ts`
  - Pass: `buildIdeOpenAction({command:'vim',terminal:true}, '/repo/src/foo.ts', ctx)` returns a shell-session request (kind `shell`) whose `bootstrap` contains the substring `vim` and the file path `/repo/src/foo.ts`; the same call with `{command:'code',terminal:false}` returns a non-session "exec" action carrying the `code` command and the file path (no session created).

- [ ] **Typecheck is clean**
  - Check: `npm run typecheck`
  - Pass: `tsc --noEmit` exits 0 with no errors.

# Files Touched
- `src/core/settings.ts`            <!-- add `ide?: { command: string; terminal: boolean }` to AppSettings + DEFAULT_SETTINGS -->
- `src/core/ideLaunch.ts`           <!-- new: canOpenInIde(), buildIdeOpenAction(), terminal-editor preset table -->
- `src/core/ideLaunch.test.ts`      <!-- new: resolver + builder unit tests -->
- `src/renderer/diffHighlight.ts`   <!-- new: highlightDiffLine(text, lang), extToLang() -->
- `src/renderer/diffHighlight.test.ts` <!-- new: highlight + escaping tests (// @vitest-environment not needed; pure string) -->
- `src/renderer/diffParse.ts`       <!-- add `lang?` / newPath-derived language to DiffFile -->
- `src/renderer/DiffPane.tsx`       <!-- wire highlight into .diff-text (L~287-294); add per-file IDE-open icon at file header (L~258-275), disabled when !canOpenInIde -->
- `src/renderer/SettingsPanel.tsx`  <!-- IDE preset dropdown + custom command row + terminal toggle -->
- `src/renderer/styles.css`         <!-- `.hljs-*` token theme (mirror `.diff-*`); IDE icon + disabled state -->
- `src/renderer/store.ts`           <!-- openInIde(file) action: route GUI vs terminal via window.api -->
- `src/main/ipc.ts`                 <!-- Channels.ideOpen + RendererApi.ideOpen() -->
- `src/preload/index.ts`            <!-- mirror ideOpen -->
- `src/main/index.ts`               <!-- ideOpen handler: terminal -> createSession(shell+bootstrap); GUI -> execFile(loginShell,['-lc', cmd]) reusing runHook's PATH-correct path; honor CCM_IDE_CMD override -->
- `package.json`                    <!-- add highlight.js dependency -->
- `e2e/smoke.mjs`                   <!-- CCM_IDE_CMD stub + open-in-IDE assertion -->

# Out of Scope
- Side-by-side / split-view highlighting changes, hunk staging/reverting, inline comments, base-ref picker (all already out of scope in worktree-diff-review and untouched here).
- Cross-file/multi-line highlight context (block comments, template strings spanning hunk boundaries): highlight per diff-line text only for v1.
- Jump-to-line / cursor positioning beyond opening the file (no `-g file:line` line targeting in v1 unless trivially free).
- Windows/Linux editor-launch tuning; target macOS behavior first.
- Bundling/installing the editors themselves or a `fix-path` dependency (reuse the existing login-shell exec path for PATH correctness).

# Risks
- **Escaping regression / XSS.** worktree-diff-review deliberately hand-escapes diff content (a `+<script>` injection vector). highlight.js's `highlight().value` is self-escaping, but the integration must NOT re-introduce raw `innerHTML` of un-highlighted text or double-unescape. The escaping AC guards this.
- **Per-line highlighting loses multi-line context** (open block comments, unterminated strings) — acceptable for v1 but may mis-highlight some lines; documented in Out of Scope.
- **macOS Finder PATH trap.** A GUI editor CLI (`code`, `cursor`) spawned directly from Electron won't be on the stripped Finder PATH. Mitigation: route through the login shell exactly like `runHook` (`execFile(shell, ['-lc', …])`) instead of `spawn('code', …)`.
- **Terminal editor needs a real TTY.** `spawn('vim', [file])` from main hangs (no controlling terminal). Must reuse the node-pty session path with a `vim <file>` bootstrap — not a direct spawn.
- **SessionKind ripple.** open-html-markdown-files noted that touching session kinds/descriptors ripples into every pty path (`session:input/resize/kill` no-ops) and `sessionRegistry.ts` pass-through. The vim path should reuse the existing `shell` kind to avoid a new kind; if a descriptor field is added, expect the registry pass-through edit.
- **e2e can't drive native pickers / real editors.** Smoke test must trigger open via `window.api`/store action with a `CCM_IDE_CMD` stub, never a real GUI app or OS dialog (per open-html-markdown-files learning).
- **Synchronous `git` + large diffs** already block the main process (worktree-diff-review caveat); adding highlight cost is renderer-side so it won't worsen main, but very large diffs may make highlighting janky — keep it lazy/per-visible-line if it bites.

# Memory References
<!-- auto-generated; <type> ∈ ledger | decision | claude-md | plan | pattern | external. -->

- <!--auto--> [plan] .claude/plans/worktree-diff-review.md -- The changes view: `worktreeDiff()` + `diffParse.ts` (typed add/del/context lines) + `DiffPane.tsx`; diff content is hand HTML-escaped — highlighting must preserve that, no marked/DOMPurify.
- <!--auto--> [plan] .claude/plans/open-html-markdown-files.md -- Existing open-file plumbing (`file:read`/`file:open-dialog`, viewer pane, `placePane`); SessionKind changes ripple into all pty paths; native dialogs aren't Playwright-drivable (drive via window.api in e2e).
- <!--auto--> [ledger] single-worktree-multi-session (followup) -- Editable-agents settings: per-row command + `commandExists` ●/○ install dot + disabled-icon-when-absent — the direct precedent for the disabled IDE icon and the IDE command setting.
- <!--auto--> [pattern] src/renderer/DiffPane.tsx:287-294 -- `.diff-text` per-line render seam for syntax spans; file header L258-275 is the seam for the per-file IDE-open icon.
- <!--auto--> [pattern] src/renderer/diffParse.ts:5-8,95-144 -- `parseUnifiedDiff` → `DiffFile[]` with per-line `{type,text}`; extend `DiffFile` with a `lang?` derived from `newPath` extension.
- <!--auto--> [pattern] src/core/settings.ts:100-176 -- `AppSettings` interface + `DEFAULT_SETTINGS`; add the `ide` field here. Persist via `settings:load`/`settings:save` IPC and `store.ts:1088 updateSettings`.
- <!--auto--> [pattern] src/main/index.ts:143-155 -- `runHook()` runs `execFile(shell, ['-lc', cmd])` — login-shell PATH-correct; reuse this exact shape to launch GUI editor CLIs (avoids the Finder PATH trap, no fix-path dep).
- <!--auto--> [pattern] src/core/session.ts:39-98 + src/main/index.ts:258-364 -- `PtySession` + `createSession`; a `shell`-kind session with `bootstrap: \`vim <file>\\r\`` is the vim/terminal-editor path.
- <!--auto--> [claude-md] CLAUDE.md:29 -- IPC contract is defined once in `src/main/ipc.ts` (Channels + RendererApi), mirrored in preload + `window.api`; add `ideOpen` in all three.
- <!--auto--> [claude-md] CLAUDE.md:19 -- e2e uses `CCM_*` env overrides (e.g. `CCM_AGENT_CMD`) to stand in for real CLIs; add `CCM_IDE_CMD` to stub the editor in the smoke test.
- <!--auto--> [external] https://shiki.style/guide/best-performance -- Never tokenize raw unified-diff lines (+/- gutter corrupts the grammar): strip the gutter, highlight the clean text, keep +/- as separate UI — exactly what `.diff-gutter`/`.diff-text` already separates.
- <!--auto--> [external] https://github.com/electron/electron/issues/5626 -- Electron launched from Finder gets a stripped PATH; spawning `code`/`cursor` directly fails ENOENT. Resolve via a login shell (as runHook does) or `fix-path`.
- <!--auto--> [external] https://neovim.io/doc/user/terminal/ -- Terminal editors (vim/nvim/helix) need a real TTY; you must run them inside a terminal/pty (Grove's node-pty session), not `spawn(editor, [file])` from main.
- <!--auto--> [external] https://github.com/MrWangJustToDo/git-diff-view -- Alternative had we chosen a rewrite: `@git-diff-view/react` + `@git-diff-view/lowlight` highlights clean source via HAST; rejected to avoid replacing the existing hand-rolled DiffPane (highlight.js chosen instead).

# Execution Log

## Run 1 — 2026-06-17

- **started_at**: 2026-06-17T01:35:25Z
- **finished_at**: 2026-06-17T01:48:10Z (~13 min)
- **outcome**: done — all 5 acceptance criteria pass
- **orchestration**: single (discipline: normal) → delegated to
  `/yang-toolkit:feature-dev-tracked`
- **goal turns**: n/a (executed directly in-session; not a turn-counted `/goal` loop)

### Criteria
| # | Criterion | Check | Result |
|---|-----------|-------|--------|
| 1 | Syntax highlight + escaping | `npx vitest run src/renderer/diffHighlight.test.ts` | PASS (5 tests) |
| 2 | Disabled IDE control when unset | `npx vitest run src/core/ideLaunch.test.ts` | PASS |
| 3 | GUI editor launch invokes command | `npm run e2e` | PASS (`ideOpen=true`) |
| 4 | Terminal editor (vim) opens shell session | `npx vitest run src/core/ideLaunch.test.ts` | PASS (6 tests) |
| 5 | Typecheck clean | `npm run typecheck` | PASS (exit 0) |

Full suite: `npx vitest run` → 156 passed. `npm run e2e` → `SMOKE_OK … ideOpen=true`.

### Scope
All modified production files are within Files Touched + `package-lock.json` (declared
in the /goal allow-list). `src/renderer/diffParse.ts` was planned but left untouched
(language derived in DiffPane via `extToLang`). `e2e/smoke.png` is the regenerated
smoke screenshot. No scope-guard violations observed.

### Decision docs
`docs/decisions/2026-06-17-changes-syntax-highlight-open-in-ide/` (01-discovery →
05-summary).
