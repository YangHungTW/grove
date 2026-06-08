# 06 — Follow-up: git init, E2E verification, worktree UI + split panes

Done after the initial MVP, in response to "都做" (do all of A/B/C).

## C — git init
Repo is now under version control (`main` branch, `.gitignore` for
node_modules/out/dist). Unlocks `/code-review` and real worktree dogfooding.

## A — real launch verification (Electron E2E)
- **Critical risk cleared:** node-pty loads AND spawns under **Electron 33**
  (ABI 141) with **no `electron-rebuild` needed** — probe returned
  `{loaded:true, saw:true}`.
- Added `e2e/smoke.mjs` (Playwright `_electron`) + `npm run e2e`. It launches the
  built app and asserts an end-to-end round-trip: typing a command in a rendered
  xterm pane creates a real file on disk (renderer → IPC → main → node-pty →
  shell side effect). Screenshot saved to `e2e/smoke.png`.

## B — worktree management UI + split panes
- **Backend:** new `env:repo-root` IPC (`RendererApi.repoRoot()`) returns
  `CCM_REPO_ROOT ?? cwd`, so the UI lists real worktrees and tests can point at a
  throwaway repo. Also fixed a `createSession` bug: a failed pty spawn now rolls
  back the registry record so a dead agent can't permanently occupy the
  single-agent slot.
- **Renderer rewrite (`main.ts`):**
  - Sidebar lists **multiple worktrees**, each expandable to its sessions, with
    `+ worktree` (inline branch input → `git worktree add`), per-worktree remove,
    and per-session close.
  - **Split panes:** the active worktree's sessions are tiled in a grid (all
    visible at once), focus ring on the active pane — not one-at-a-time tabs.
- **E2E extended** (against a temp git repo via `CCM_REPO_ROOT`): asserts
  `split=2` panes visible simultaneously, the disk round-trip, and that
  `+ worktree` creates a real git worktree (`.git` link on disk). Result:
  `SMOKE_OK split=2 roundTrip=true worktreeCreated=true`.

## Verification (final)
- `npx vitest run` → 16/16 pass.
- `npm run typecheck && npm run build` → exit 0.
- `npm run e2e` → SMOKE_OK (split + round-trip + worktree create).

## Still open (next)
- ⌘1–9 worktree switching / drag-resize splits / persist layout across relaunch.
- Real agent binary wiring (`claude` is a shell alias; node-pty needs an
  executable on PATH).
- Throttle `detectState` per data chunk; packaging (electron-builder).
