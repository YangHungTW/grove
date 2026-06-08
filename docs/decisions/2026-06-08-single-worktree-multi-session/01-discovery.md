# 01 — Discovery

**Feature:** single-worktree-multi-session (ccmanager-gui)
**Source plan:** `.claude/plans/single-worktree-multi-session.md`

## What is being built
An Electron GUI (ccmanager-gui) where **one git worktree hosts multiple
concurrent PTY sessions** — one primary coding agent plus auxiliary panes
(shell, dev server, log tail) — with a cmux-style sidebar/tabs/splits UI,
per-session state badges, and notifications.

## Where in the codebase
Greenfield repo. Only `.claude/` existed at start. New layout:
- `src/core/`     — UI-agnostic engine (registry, pty, worktree, state detection)
- `src/main/`     — Electron main process (owns ptys + registry + IPC)
- `src/preload/`  — contextBridge API
- `src/renderer/` — xterm.js UI (sidebar tree, tabs/splits, notifications)

## Reference projects
- **ccmanager** (kbwo): TS/Node TUI, PTY-per-session, worktree CRUD, per-agent
  state detection. We **port its logic** (pty lifecycle, worktree git cmds,
  state-detection heuristics) into `src/core`, not its TUI rendering.
- **cmux**: native macOS terminal — workspace with multiple panes, sidebar
  metadata, notifications. We borrow the UX model (multi-pane per worktree).

## Toolchain present
Node v25.4.0, npm 11.7.0, git 2.50.1.
