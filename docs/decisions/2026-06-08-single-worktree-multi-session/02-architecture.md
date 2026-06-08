# 02 — Architecture (brief)

Smallest design that supports the acceptance criteria. Full narrative lives in
the plan's *Design Notes*; this is the implementable shape.

## Data model (`src/core/types.ts`)
```
Project   { id, repoRoot }
Worktree  { id, path, branch, base }
Session   { id, worktreeId, kind, title, cwd, command, state, pid }

kind  = 'agent' | 'shell' | 'server' | 'task'
state = 'starting' | 'idle' | 'busy' | 'waiting' | 'exited'
```

## Core modules
- **`sessionRegistry.ts`** — in-memory map `worktreeId -> Session[]`.
  Invariant: **≤1 `kind:'agent'` per worktree**; auxiliary kinds unbounded.
  Pure data structure (no pty) so it is trivially unit-testable.
- **`session.ts`** — `PtySession` wraps `node-pty`: spawn/data/resize/kill,
  tracks `state`, emits events. Decoupled from the registry.
- **`worktree.ts`** — thin wrapper over `git worktree add/list/remove` using
  `child_process`. Operates on a caller-supplied repo root (temp repo in tests).
- **`stateDetection.ts`** — pure function `detectState(buffer, agent) -> state`.
  Data-driven rules per agent (Claude Code first). Fixture-tested.

## Electron wiring
- **main** owns the registry + all `PtySession`s + git ops; exposes typed IPC
  (`src/main/ipc.ts`): `worktree:create|list|remove`,
  `session:create|input|resize|kill`; events `session:data|state-change|exit`.
- **preload** exposes a narrow `window.api` via contextBridge.
- **renderer** mounts one xterm.js per session; sidebar tree + tabs/splits +
  notifications.

## Build / test tooling
- **electron-vite** (main + preload + renderer bundling), **TypeScript**,
  **vitest** (core unit tests run in Node, no Electron needed).
- `node-pty` native module — `electron-rebuild` for the app; vitest exercises
  it under the system Node.

## Decision: terminal engine = xterm.js, NOT Ghostty
cmux embeds **libghostty** because it is a *native* Swift/AppKit app with no
built-in terminal widget. We are Electron-based, so **xterm.js** already is our
terminal emulator (VT parsing + rendering), and **node-pty** is the PTY backend.
No need to base on Ghostty or any terminal. We would only need libghostty if we
went native (Swift/Tauri-native rendering) or needed Ghostty-level GPU
rendering / config compatibility; xterm.js + WebGL addon is sufficient here.

## node-pty native gotcha (resolved)
The prebuilt `spawn-helper` for darwin shipped without the execute bit →
`posix_spawnp failed`. Fixed durably via an inline `postinstall` chmod in
package.json (cross-platform guarded). Verified spawn works under Node v25.4.0.

## Key decision: core is Electron-free
Everything in `src/core` imports only Node built-ins + `node-pty`. That keeps the
four acceptance-criteria test suites runnable under plain `vitest` without
booting Electron.
