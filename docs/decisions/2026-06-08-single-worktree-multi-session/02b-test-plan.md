# 02b — Test Plan

Ordered highest-leverage → edge case. Each maps to an acceptance criterion.

## Suite 1 — `src/core/sessionRegistry.test.ts`  (the feature crux)
1. **holds multiple sessions per worktree** — `addSession` twice for one
   worktreeId → `getSessions(wt)` returns both. Pins the 1→N relationship.
2. **rejects a second agent in the same worktree** — adding a 2nd
   `kind:'agent'` throws; pins the single-primary-agent invariant.
3. **auxiliary kinds are unbounded** — many `shell`/`server`/`task` sessions
   coexist with the one agent. Pins "1 agent + auxiliary panes".
4. **removeSession / getSession** — remove drops it from the worktree list.
5. **agent allowed again after removal** — removing the agent lets a new agent
   be added (invariant is about *live* sessions). Edge case.

## Suite 2 — `src/core/session.test.ts`  (pty lifecycle)
1. **spawn emits data** — a `shell` session running `echo` emits ≥1 `data`
   event within 2s.
2. **kill marks exited** — `kill()` sets `state==='exited'`; pid no longer alive.
3. **resize does not throw** — `resize(cols,rows)` on a live session is safe.

## Suite 3 — `src/core/worktree.test.ts`  (git ops, temp repo)
1. **create + list** — in a temp git repo, `createWorktree` then `listWorktrees`
   includes the new path + branch.
2. **remove** — `removeWorktree` makes it disappear from `git worktree list`.
3. **list parses main worktree too** — listWorktrees returns the primary repo
   entry. Edge case for the parser.

## Suite 4 — `src/core/stateDetection.test.ts`  (pure)
1. **waiting** — an input-prompt fixture → `'waiting'`.
2. **busy** — an in-progress fixture → `'busy'`.
3. **idle** — a completed/prompt-returned fixture → `'idle'`.
4. **unknown agent falls back to idle** — unrecognized agent id → `'idle'`.
   Edge case.

## Suite 5 — build (acceptance criterion 5, not a vitest suite)
- `npm run typecheck` → exit 0
- `npm run build` (electron-vite build) → exit 0, out dir has main + renderer.
