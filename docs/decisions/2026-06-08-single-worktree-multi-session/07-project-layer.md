# 07 — Project layer (select project + per-project worktrees)

Added in response to "現在的 ui 我要怎麼選 project / create worktree" — the MVP was
single-project (cwd / CCM_REPO_ROOT). Now the full hierarchy:
**Project (git repo) → Worktree (branch) → Session (pty pane)**.

## What changed
- **`src/core/projectStore.ts` (TDD, 6 tests):** persisted recent-projects list
  (JSON), most-recent-first, dedupe-on-readd, remove. Owning process supplies the
  file path.
- **`src/core/worktree.ts`: `isGitRepo()` (TDD, +1 test):** validates a folder is
  a git work tree before it can be opened as a project.
- **Backend (`main` + `ipc` + `preload`):**
  - `project:open-dialog` → native `dialog.showOpenDialog` → validates git →
    records in store.
  - `project:add` (open-by-path; also used by the dialog and testable),
    `project:list-recent`, `project:remove`.
  - Store path = `CCM_STORE` (tests) or `app.getPath('userData')/projects.json`.
- **Renderer:** sidebar is now `+ Open project…` + a **Projects** list. Each
  project is a `.project` block (accordion: selecting one collapses others) that
  expands to its worktrees → sessions. `+ worktree` is per-project. Clicking a
  project title always selects+expands it (no toggle-collapse — clearer "select
  project" UX). On launch, recent projects load and the launched repo is
  auto-added if it is a git repo.

## Both entry points (as requested)
1. **Native folder dialog** — `+ Open project…`.
2. **Recent list** — persisted across launches, shown under Projects.

## Verification
- `npx vitest run` → **23/23** (5 suites).
- `npm run typecheck && npm run build` → exit 0.
- `npm run e2e` (two temp repos + seeded store) →
  `SMOKE_OK projects=2 split=2 roundTrip=true worktreeCreated=true`:
  both projects listed, selecting A loads its worktrees, a real worktree is
  created under A, two panes tile, and a typed command writes a file under A.

## Note on cmux vs ccmanager
The Project→Worktree hierarchy is **ccmanager-style** (cmux has no formal project
concept — it is workspace-oriented). The split-pane / per-session state / notify
UX is the cmux-inspired part.

## Still open
- ⌘1–9 project/worktree switching; drag-resize splits; persist session layout.
- Real agent binary (`claude` is a shell alias; node-pty needs a PATH executable).
