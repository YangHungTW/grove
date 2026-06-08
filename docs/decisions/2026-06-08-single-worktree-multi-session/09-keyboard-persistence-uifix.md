# 09 — Keyboard nav, layout persistence, and a terminal-fill fix

## Keyboard navigation (renderer)
- **⌘1–9** → switch to the Nth worktree of the active project.
- **⌘⌥1–9** → switch to the Nth project.
- **⌘T** → new shell in the active worktree (existing).
- **⌘W** → close the focused session.

## Session layout persistence
- **`src/core/layoutStore.ts` (TDD, 4 tests):** persists `SessionDescriptor[]`
  (`{repoRoot, worktreePath, kind, title}`) to JSON. PTYs can't be resurrected, so
  on relaunch sessions are **respawned** fresh.
- Store path = `CCM_LAYOUT` (tests) or `app.getPath('userData')/layout.json`.
- Renderer saves on every session/worktree/project change (`persistLayout`), and
  restores a project's sessions lazily when it is first activated
  (`restoreProject`, guarded by a `restoring` flag so mid-restore saves don't
  clobber not-yet-restored projects).

## UI fix — terminal not filling its pane (user-reported "UI 不正常")
`addSession` mounted the pane and focused it but never called `layoutPanes()`, so
`FitAddon.fit()` never ran for the new pane → xterm stayed at the default 24 rows
and the lower part of the pane was blank. Fix: call `layoutPanes()` right after
`mountPane` in `addSession`, plus a CSS rule forcing `.xterm`/viewport/screen to
`height:100%`.

## Verification
- Unit: **28/28** (added LayoutStore suite).
- `npm run typecheck && npm run build` → exit 0.
- `npm run e2e` →
  `projects=2 split=2 roundTrip=true worktreeCreated=true agentLaunched=true `
  `singleAgent=true kbdNav=true restored=3`
  (relaunch restored all 3 sessions; ⌘2/⌘1 switched worktrees). Screenshot shows
  three terminals fully filling a 2×2 split.

## Still open
- Drag-resize split sizes; persist focus/active-worktree across relaunch;
  state-detection (busy/waiting dots) polish under shell-wrapped agents.
