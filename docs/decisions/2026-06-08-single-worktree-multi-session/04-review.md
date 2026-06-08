# 04 — Review

`/code-review` (code-review plugin) diffs the git tree; this project is **not a
git repo**, so the plugin could not run. Manual self-review below.

## Correctness
- **node-pty `spawn-helper` exec bit** — root-caused `posix_spawnp failed` to the
  prebuilt helper shipping as `-rw-r--r--`. Fixed durably via inline
  `postinstall` chmod (cross-platform guarded). Verified spawn under Node 25.
- **preload path** — `main` referenced `../preload/index.js` but electron-vite
  emits `.mjs` under `"type":"module"`. Fixed to `index.mjs` (would otherwise
  break `window.api` at runtime). Not covered by an acceptance criterion (those
  gate typecheck+build only) — caught by manual inspection of `out/`.
- **single-agent invariant** — enforced in `SessionRegistry.addSession`; the
  renderer surfaces the thrown `SingleAgentError` as a toast. Good.

## Known limitations / follow-ups (honest scope)
- **Tabs + splits**: the renderer currently switches a single active pane via the
  sidebar (sidebar rows act as tabs). True split-pane layout (⌘\\) is NOT
  implemented — deferred.
- **Worktree management UI**: `WORKTREE_ID` is a fixed `'local'`. The core
  `worktree` module (create/list/remove) is tested and IPC-exposed, but the
  sidebar does not yet drive multi-worktree CRUD. The *feature crux* (multiple
  sessions in one worktree) is fully delivered.
- **State detection cadence**: `detectState` runs on every pty data chunk in
  main. Fine for now; debounce/throttle if CPU shows up under chatty agents.
- **`_ApiContract` type alias** in main is a light touch — it imports the
  `RendererApi` type but does not statically prove every channel has a handler.
  A stronger compile-time check could map `Channels` → handler presence.

## Security
- `contextIsolation: true`, no `nodeIntegration`, narrow `contextBridge` surface,
  CSP meta in `index.html`. Reasonable baseline.

No blocking issues. Limitations are documented and out-of-scope per the plan
(merge flow, splits-beyond-MVP, remote panes were already deferred).
