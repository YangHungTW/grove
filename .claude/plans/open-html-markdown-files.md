---
slug: open-html-markdown-files
created_at: 2026-06-10T13:40:17Z
discipline: normal
orchestration: single
team_size: 3
time_budget: 25 turns
depends_on: []
status: done
started_at: 2026-06-10T14:23:09Z
finished_at: 2026-06-10T14:41:05Z
executor: main
---

# Goal
Open an HTML or Markdown file inside Grove in a non-terminal "viewer" pane (Markdown rendered + sanitized; HTML in a sandboxed iframe).

# Acceptance Criteria
<!-- machine-parsed by /yang-toolkit:execute-plan. Each item MUST follow:
- [ ] **<short name>**
  - Check: `<runnable command in backticks>`
  - Pass: <observable condition; no fuzzy words>
-->

- [ ] **Markdown renders and is sanitized**
  - Check: `npm test`
  - Pass: vitest exits 0 and a new test in `src/renderer/markdown.test.ts` asserts that `renderMarkdown("# Hi\n\n<img src=x onerror=alert(1)>")` returns a string containing `<h1>Hi</h1>` and NOT containing the substring `onerror`.

- [ ] **Viewer pane kind compiles end to end**
  - Check: `npm run typecheck`
  - Pass: `tsc` exits 0 with `SessionKind` in `src/core/types.ts` including a viewer kind and all pty-only IPC paths (`session:input` / `:resize` / `:kill`) guarded against non-pty sessions.

- [ ] **A .md and a .html file each open in a viewer pane**
  - Check: `npm run e2e`
  - Pass: e2e exits 0; the smoke probe writes a temp `note.md` and a temp `page.html`, opens each via the renderer open-file path (calling the store action / `window.api` directly so no native OS dialog is needed), and asserts `.pane[data-kind="viewer"]` count is ≥ 1 for each, the markdown pane's text contains the rendered heading text, and the html pane contains an `<iframe>` element.

# Files Touched
- src/core/types.ts
- src/main/ipc.ts
- src/main/index.ts
- src/preload/index.ts
- src/renderer/store.ts
- src/renderer/PaneGrid.tsx
- src/renderer/ViewerPane.tsx (new)
- src/renderer/markdown.ts (new) + src/renderer/markdown.test.ts (new)
- src/renderer/TabBar.tsx
- src/renderer/Dialog.tsx
- src/renderer/Icons.tsx
- src/renderer/styles.css
- package.json (add `marked`, `dompurify`, `@types/dompurify`)
- e2e/smoke.mjs

# Out of Scope
- Editing files in the viewer (read-only render only).
- Live file-watch / auto-reload when the file changes on disk.
- Markdown extensions beyond GitHub-flavored basics (no mermaid, no math).
- Any change to terminal/pty session behavior beyond guarding the new non-pty kind.

# Risks
- Extending `SessionKind` (`'agent' | 'shell'`) ripples into code that assumes a live pty exists (`session:input/resize/kill`, `session:data`, state detection). Every pty path must no-op for the viewer kind or the renderer/main will throw on a viewer "session". (anchor: src/main/index.ts:185-345)
- This plan introduces the shared non-terminal pane scaffold (kind-aware `PaneGrid` + pty-skip in `createSession`). The sibling plan `worktree-diff-review` reuses the same scaffold — land this one first, or expect the diff plan to recreate it.
- Native `dialog.showOpenDialog` cannot be driven by Playwright (OS-level dialog). The e2e probe must invoke the open path through `window.api` / the store action directly, not by clicking through the native picker.
- "Sandboxed iframe, scripts allowed" (chosen): interactive HTML works, but a malicious HTML file can run JS inside the sandboxed frame. Keep `sandbox` without `allow-same-origin` so the frame cannot reach `window.api` / parent origin. Markdown stays on the marked+DOMPurify path regardless.
- `marked` removed its built-in `sanitize` option years ago — sanitizing is the caller's job; the classic bypass is the `<img onerror>` vector, which the unit test pins.

# Memory References
<!-- auto-generated below; remove individual lines if irrelevant.
Lines without <!--auto--> are preserved on --revise.
<type> is one of: ledger | decision | claude-md | plan | pattern | external.
For [external], <path> is a URL. -->

- <!--auto--> [pattern] src/renderer/PaneGrid.tsx:88 -- `<Pane>` always builds an xterm Terminal; add a kind-aware branch that renders `<ViewerPane>` for non-pty sessions (all panes stay mounted, no remount).
- <!--auto--> [pattern] src/main/ipc.ts:10 -- `Channels` map + `RendererApi` interface; add a `file:read` (and optional open-dialog) channel by mirroring the existing invoke handlers.
- <!--auto--> [pattern] src/renderer/store.ts:436 -- `addSession(worktreeId, kind, agentDef?, titleOverride?, resumeId?)` is the single creation seam; thread a file path/content through it for the viewer kind.
- <!--auto--> [pattern] src/renderer/Dialog.tsx:1 -- `DialogState` discriminated union + per-kind component is the modal pattern if an in-app "open file" path picker is preferred over the native dialog.
- <!--auto--> [pattern] src/renderer/index.html:6 -- current CSP is `default-src 'self'`; bundled `marked`/`dompurify` load as 'self' via vite, but an iframe needs the CSP/sandbox interplay verified at runtime.
- <!--auto--> [decision] docs/decisions/2026-06-08-single-worktree-multi-session -- the app has only ever had pty panes; this is the first non-terminal surface.
- <!--auto--> [external] https://github.com/markedjs/marked/discussions/1232 -- marked dropped built-in sanitize; pair with DOMPurify. The `<img src=x onerror=...>` handler is the canonical XSS entry point a sanitizer must strip.

# Execution Log
<!-- filled by /yang-toolkit:execute-plan post-hoc. Leave empty in draft. -->

## Run 1 — 2026-06-10
- **started_at:** 2026-06-10T14:23:09Z
- **finished_at:** 2026-06-10T14:41:05Z (~18 min)
- **outcome:** done
- **orchestration:** single (normal discipline; implemented directly toward the /goal condition)
- **goal evaluator:** all three acceptance criteria satisfied:
  - C1 `npx vitest run` → exit 0, 67/67 (new `markdown.test.ts`: `renderMarkdown` keeps `<h1>Hi</h1>`, strips `onerror`/`<script>`).
  - C2 `npm run typecheck` → exit 0; `SessionKind` now `'agent' | 'shell' | 'viewer'`; `createSession` returns early for viewer (no pty); `session:input/resize/kill` no-op via the `ptys` map.
  - C3 `npm run e2e` → exit 0; `SMOKE_OK … fileViewer=true viewerPanes=2 htmlIframe=1 restored=4` (viewer panes correctly excluded from persistence).
- **build:** renderer bundle grew to ~1.1 MB (added `marked` + `dompurify`); acceptable for a desktop app.
- **implementation:** new `src/renderer/markdown.ts` (marked + DOMPurify, lazily window-bound) + `ViewerPane.tsx` (markdown → sanitized div; HTML → `<iframe sandbox="allow-scripts">`). New IPC `file:open-dialog` / `file:read`. Store `openFile`/`promptOpenFile`/`browseForFile` + `openFile` dialog + TabBar "+ file" button + `DocIcon`.
- **test-DOM note:** `marked`+DOMPurify unit test runs under **jsdom** (`// @vitest-environment jsdom`). happy-dom was tried first but mis-sanitized (stripped `<h1>`, kept `onerror`), so it was removed and jsdom added as a devDep.
- **scope deviations (all benign, recorded honestly):**
  1. `src/core/sessionRegistry.ts` — NOT in the declared Files Touched; a one-line pass-through of the new `filePath`/`viewerKind` fields was required for the snapshot to carry them. No behavior change for agent/shell.
  2. `package-lock.json` — lockfile artifact of the declared `package.json` dependency additions.
  3. `e2e/smoke.png` — screenshot artifact auto-written by the e2e run.
- Note: `src/core/settings.ts`, `src/core/worktree.ts`, `src/core/worktree.test.ts`, `src/renderer/SettingsPanel.tsx` also show as modified in the working tree — those belong to the earlier `worktree-timestamp-placeholder` plan (still uncommitted), not this run.
