# 08 — Wire `+ agent` to the real claude CLI

Before: `+ agent` spawned `claude` directly via node-pty, which fails because
`claude` is a **shell alias** (`claude --plugin-dir ~/.dotfile/claude/plugin`),
not resolvable by a direct `posix_spawnp`.

## Approach: launch agents inside the interactive login shell
For `kind:'agent'`, main now spawns the user's shell as **interactive + login**
(`$SHELL -il`) and types the agent command into it (the new `PtySession.bootstrap`
option). This is exactly like opening a terminal and running `claude`, so PATH,
profile, and aliases all apply. The interactive-shell noise we saw in a non-tty
probe does not occur under node-pty because it allocates a real tty.

- `launchSpecFor(req)` in `main/index.ts`: agent → `{ command: $SHELL, args:
  ['-il'], bootstrap: '<agentCmd>\r' }`. Other kinds spawn directly as before.
- Agent command overridable via **`CCM_AGENT_CMD`** (default `claude`) — tests use
  this to avoid real auth.
- `PtySession.bootstrap` (TDD, cycle 7): input written into the pty right after
  spawn.

## Verification
- Unit: `PtySession` writes bootstrap after spawn (24 tests total, all green).
- E2E (`npm run e2e`): `+ agent` with `CCM_AGENT_CMD=touch <marker>` creates the
  marker on disk → `agentLaunched=true`; a second `+ agent` is rejected →
  `singleAgent=true`.
- **Real claude probe** (app's exact mechanism: `zsh -il` + typed
  `claude --version`): terminal title showed
  `claude --plugin-dir ~/.dotfile/claude/plugin --version` (alias expanded!) and
  output `2.1.168 (Claude Code)`. So `+ agent` launches the real CLI with the
  user's plugin-dir.

## Notes
- Default agent launch types bare `claude\r` (no `exec`), so when the agent exits
  the pane drops back to a live shell — you can relaunch. Set `CCM_AGENT_CMD` to
  change the command (e.g. add flags) without code edits.
- State detection (`detectState`, agent='claude') runs on the pane output as
  before; p10k's `❯` prompt does not false-match the waiting rule (which requires
  `❯ <digit>.`).
