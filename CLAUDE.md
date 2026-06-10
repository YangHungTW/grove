# Grove

Electron desktop app — a control room for running multiple coding-agent terminal
sessions per git worktree. React + xterm.js + node-pty.

## Stack & tooling
- **Package manager: npm** (only `package-lock.json` is present — do not use yarn/pnpm).
- **TypeScript, ESM** (`"type": "module"`). React 18, Electron 33, built with electron-vite.
- No eslint/prettier config and no pinned Node version in the repo — don't assume either.

## Commands
- `npm run dev` — run the app (electron-vite dev).
- `npm run build` / `npm start` — build, then launch the built app.
- `npm run typecheck` — `tsc --noEmit`. Must be clean before declaring work done.
- `npm test` runs **vitest in watch mode** (hangs in a non-interactive shell).
  For a one-shot run use **`npx vitest run`**.
- `npm run e2e` — builds, then runs `e2e/smoke.mjs`: a Playwright smoke test
  against the *built* Electron app using throwaway temp git repos and `CCM_*`
  env overrides (e.g. `CCM_AGENT_CMD` stands in for a real agent CLI).
- Verify substantive changes with all three: `npx vitest run` + `npm run typecheck` + `npm run e2e`.

## Architecture (3 Electron layers + a pure core)
- `src/core/` — Electron-free domain logic (sessions, worktrees, settings,
  state detection). This is where unit tests live (`*.test.ts`, vitest).
- `src/main/` — the Electron main process: owns the session registry + live
  pty processes, the git worktree operations, and all IPC handlers.
- `src/preload/` — the contextBridge exposing `window.api` to the renderer.
- `src/renderer/` — React UI (store, panes, tabs, dialogs).
- **IPC contract is defined once** in `src/main/ipc.ts` (`Channels` + the
  `RendererApi` interface), mirrored in `src/preload/index.ts`, and consumed as
  `window.api.*`. Add a channel in all three places to keep them in lock-step.

## Testing notes
- Tests that need a DOM use a per-file pragma: `// @vitest-environment jsdom`
  (jsdom — not happy-dom, which mis-sanitizes HTML).
- `src/core` tests spawn real `git`/pty processes against temp dirs; they have a
  raised timeout in `vitest.config.ts`.
