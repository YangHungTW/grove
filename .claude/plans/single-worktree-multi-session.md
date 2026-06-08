---
slug: single-worktree-multi-session
created_at: 2026-06-08T03:12:39Z
discipline: tdd
orchestration: single
team_size: 3
time_budget: 25 turns
depends_on: []
status: done
started_at: 2026-06-08T03:20:19Z
finished_at: 2026-06-08T03:33:23Z
executor: main
---

# Goal
Build an Electron GUI (ccmanager-gui) where a single git worktree hosts multiple
concurrent PTY sessions — one primary coding agent plus auxiliary panes (shell,
dev server, log tail) — with cmux-style sidebar/tabs/splits, per-session state
badges and notifications.

# Acceptance Criteria
<!-- machine-parsed by /yang-toolkit:execute-plan. Each item MUST follow:
- [ ] **<short name>**
  - Check: `<runnable command in backticks>`
  - Pass: <observable condition; no fuzzy words>
-->

- [ ] **One worktree holds N sessions, one primary agent**
  - Check: `npm test -- src/core/sessionRegistry.test.ts --run`
  - Pass: Exit code 0. Tests assert (a) a single worktree id can hold ≥2 session
    records; (b) `addSession` rejects a 2nd session with `kind:'agent'` for the
    same worktree (only one primary agent); (c) auxiliary kinds
    (`shell`/`server`/`task`) are unbounded per worktree.

- [ ] **PTY session lifecycle**
  - Check: `npm test -- src/core/session.test.ts --run`
  - Pass: Exit code 0. Spawning a `shell` session emits at least one `data`
    event within 2s; calling `kill()` sets session state to `exited` and the
    underlying pty pid is no longer alive.

- [ ] **Worktree git operations**
  - Check: `npm test -- src/core/worktree.test.ts --run`
  - Pass: Exit code 0. Against a temp git repo: `createWorktree` adds an entry
    visible in `git worktree list`; `listWorktrees` returns it with branch+path;
    `removeWorktree` deletes it and it disappears from `git worktree list`.

- [ ] **Agent state detection (busy/idle/waiting)**
  - Check: `npm test -- src/core/stateDetection.test.ts --run`
  - Pass: Exit code 0. Given fixture output buffers for Claude Code, the
    detector returns `waiting` for an input-prompt buffer, `busy` for an
    in-progress buffer, and `idle` for a completed buffer.

- [ ] **App typechecks and builds**
  - Check: `npm run typecheck && npm run build`
  - Pass: Both commands exit 0; `dist/` (or configured out dir) contains the
    bundled main + renderer entry files.

# Files Touched
- `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.ts`
- `src/core/types.ts`              — Project / Worktree / Session models
- `src/core/sessionRegistry.ts`    — 1 worktree → N sessions, single-primary-agent invariant
- `src/core/session.ts`           — node-pty wrapper (spawn/data/resize/kill/state)
- `src/core/worktree.ts`          — git worktree create/list/remove (+ merge later)
- `src/core/stateDetection.ts`    — ported per-agent state strategies
- `src/main/index.ts`             — Electron main: owns ptys + registry, IPC handlers
- `src/main/ipc.ts`               — typed IPC channel contract
- `src/preload/index.ts`          — contextBridge API
- `src/renderer/` (App, Sidebar tree, TerminalPane/xterm, Tabs+Splits, Notifications)
- `src/core/*.test.ts`            — vitest suites for each core module

# Out of Scope
- Multiple **competing** coding agents in one worktree + any file-locking /
  conflict-resolution machinery (user chose 1 agent + auxiliary panes).
- Worktree **merge** flow and Claude session-data copy-between-worktrees
  (defer to a follow-up; create/list/remove only in this plan).
- Remote / SSH workspaces and in-app browser panes (cmux has these; not now).
- Reusing ccmanager's TUI/Ink rendering layer.

# Risks
- **Reuse-vs-rewrite of ccmanager (the open question you asked me to recommend):**
  Recommendation = *port, don't depend*. ccmanager is a TUI; its rendering is
  React-for-CLI and not reusable, but three pieces of its logic are valuable and
  worth porting into our UI-agnostic `src/core`: (1) node-pty spawn/lifecycle,
  (2) git worktree commands, (3) per-agent state-detection regex/heuristics.
  Vendoring the logic into `core` (with attribution) avoids coupling our release
  cadence to ccmanager and keeps `core` testable headless. Check ccmanager's
  LICENSE before copying code; if incompatible, reimplement from its behavior.
- **node-pty native build** must match the Electron ABI — needs
  `electron-rebuild` (or prebuilt binaries) or the app crashes on launch.
- **State detection is brittle**: agent CLIs change their output; keep strategies
  data-driven (fixtures + config) so they can be tuned without code edits.
- **xterm.js performance** with many live panes; lazy-mount inactive panes and
  cap scrollback.
- **Session persistence across relaunch**: PTYs are process-bound and cannot be
  truly resurrected — restore *layout + cwd + scrollback*, mark old ptys dead and
  offer one-click respawn (cmux does the same).

# Design Notes
<!-- not machine-parsed; this is the architecture answer to "可以怎麼設計?" -->

## Data model — decouple Worktree from Session (the core idea)
```
Project   (a git repo root)
  └─ Worktree[]   { id, path, branch, base }
        └─ Session[] { id, worktreeId, kind, title, cwd, command, state, pid }
```
- `kind: 'agent' | 'shell' | 'server' | 'task'`. Invariant: **≤1 `agent` per
  worktree** (enforced in `sessionRegistry`), unlimited auxiliary sessions.
- All sessions in a worktree share `worktree.path` as default cwd → that is what
  makes "single worktree, multiple sessions" safe: only one writer (the agent),
  the rest observe/serve.

## Process model (Electron)
- **Main process** owns every node-pty, the session registry, and git ops. It is
  the single source of truth and streams `session:data` events keyed by
  sessionId.
- **Renderer** mounts one xterm.js instance per session; sends
  `session:input`/`session:resize`; renders sidebar + tabs/splits + badges.
- **IPC contract** (typed, in `src/main/ipc.ts`): `worktree:create|list|remove`,
  `session:create|input|resize|kill`, events `session:data`,
  `session:state-change`, `session:exit`.

## UX (cmux-inspired)
- Left **sidebar tree**: Worktree → its Sessions, each with a state dot
  (idle/busy/waiting) and the primary-agent marked.
- Main area: **tabs + split panes** scoped to the active worktree; ⌘1–9 switch
  worktree, ⌘T new session in current worktree, ⌘\\ split.
- **Notifications**: when a session flips to `waiting`, its pane gets a ring and
  the sidebar row lights up; a notification panel aggregates pending ones.

## Build sequence (tdd, single agent; red→green per module)
1. Scaffold: electron-vite + TS + vitest + node-pty (+ electron-rebuild). 
2. `core/types` + `core/sessionRegistry` (the 1:N + single-agent invariant) — tests first.
3. `core/session` node-pty wrapper (spawn/data/resize/kill/state) — tests first.
4. `core/worktree` git ops against temp repo — tests first.
5. `core/stateDetection` ported strategies + fixtures — tests first.
6. `main` wiring: registry + ptys + IPC handlers; `preload` contextBridge.
7. `renderer`: TerminalPane (xterm) → Sidebar tree → Tabs/Splits → Notifications.
8. typecheck + build green.

# Memory References
<!-- auto-generated below; remove individual lines if irrelevant.
Lines without <!--auto--> are preserved on --revise. -->

<!-- no prior context found (greenfield repo: no ledger, no CLAUDE.md, no docs/decisions) -->

# Execution Log

## Run 1 — 2026-06-08
- **started_at:** 2026-06-08T03:20:19Z
- **finished_at:** 2026-06-08T03:33:23Z  (~13 min)
- **outcome:** done — all 5 acceptance criteria pass.
- **orchestration:** single (discipline: tdd) → delegated to `/yang-toolkit:tdd-feature`.
- **cycles:** 4 red→green; **16 tests** total, all green.
- **decision dir:** `docs/decisions/2026-06-08-single-worktree-multi-session/`
- **acceptance criteria results (exact commands):**

  | criterion | command | result |
  |---|---|---|
  | One worktree holds N sessions, one primary agent | `npm test -- src/core/sessionRegistry.test.ts --run` | exit 0, 6 passed |
  | PTY session lifecycle | `npm test -- src/core/session.test.ts --run` | exit 0, 3 passed |
  | Worktree git operations | `npm test -- src/core/worktree.test.ts --run` | exit 0, 3 passed |
  | Agent state detection | `npm test -- src/core/stateDetection.test.ts --run` | exit 0, 4 passed |
  | App typechecks and builds | `npm run typecheck && npm run build` | exit 0; `out/` has main + renderer |

- **scope-guard:** no scope-guard hook wired (best-effort). One intentional
  in-scope deviation: a node-pty `spawn-helper` chmod was added as an **inline
  `postinstall` script inside package.json** (not a new `scripts/` file) to keep
  within declared Files Touched.
- **notes / partials (see `04-review.md`, `05-summary.md`):** split-pane layout
  and worktree-management UI are MVP-deferred; core `worktree` module is fully
  tested + IPC-exposed. Fixed a preload path bug (`index.js` → `index.mjs`) found
  by inspecting build output (not gated by any criterion).
