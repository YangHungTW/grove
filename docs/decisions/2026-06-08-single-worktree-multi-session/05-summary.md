# 05 — Summary

**Feature:** single-worktree-multi-session (ccmanager-gui)
**Outcome:** all 5 acceptance criteria green.

## What shipped
A greenfield **Electron + xterm.js + node-pty** app skeleton where one git
worktree hosts multiple concurrent PTY sessions (one primary agent + auxiliary
panes), with a cmux-style sidebar, per-session state dots, and attention
notifications.

- **`src/core/` (Electron-free engine, fully unit-tested):**
  - `types.ts` — Project / Worktree / Session domain model.
  - `sessionRegistry.ts` — 1 worktree → N sessions; **≤1 agent per worktree**
    invariant (`SingleAgentError`).
  - `session.ts` — `PtySession` node-pty wrapper (spawn/data/resize/kill/state).
  - `worktree.ts` — `git worktree` create/list/remove + porcelain parser.
  - `stateDetection.ts` — data-driven per-agent waiting/busy/idle classifier.
- **`src/main/`** — Electron main owns the registry + live ptys + git ops, and a
  typed IPC contract (`ipc.ts`); streams data/state/exit to the renderer.
- **`src/preload/`** — narrow `window.api` via contextBridge.
- **`src/renderer/`** — xterm.js panes, sidebar tree, state badges, toasts.
- **Tooling** — electron-vite build, tsconfig (strict), vitest; inline
  `postinstall` chmod fixing node-pty's `spawn-helper`.

## Tests / cycles
- **4 red→green cycles, 16 tests, all passing.** See `03-tdd-cycles.md`.
- Acceptance criteria (exact plan commands), all exit 0:
  - `npm test -- src/core/sessionRegistry.test.ts --run` → 6 passed
  - `npm test -- src/core/session.test.ts --run` → 3 passed
  - `npm test -- src/core/worktree.test.ts --run` → 3 passed
  - `npm test -- src/core/stateDetection.test.ts --run` → 4 passed
  - `npm run typecheck && npm run build` → exit 0; `out/` has main + renderer.

## Key decisions
- **Terminal engine = xterm.js, not Ghostty.** cmux embeds libghostty because it
  is a native Swift app; our Electron stack already has xterm.js as the VT
  emulator + node-pty as the PTY backend. (See `02-architecture.md`.)
- **Port, don't depend** on ccmanager: its pty/worktree/state-detection logic
  was reimplemented in `src/core`, not imported from its TUI layer.

## Abandoned / deferred (per plan Out of Scope + review)
- True split-pane layout (sidebar currently acts as tabs over one active pane).
- Worktree-management UI (core module exists + IPC-exposed; UI uses a fixed
  `local` worktree). The multi-session-per-worktree crux is delivered.
- Worktree merge flow, multi competing agents, remote/SSH + browser panes.

## Open follow-ups
1. Wire the sidebar to `worktree:create|list|remove` for real multi-worktree UX.
2. Implement split panes + ⌘1–9 worktree switching.
3. Throttle `detectState` per data chunk; persist layout across relaunch.
4. `electron-rebuild` step + packaging (electron-builder) for distributables.
