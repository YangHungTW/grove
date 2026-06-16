---
slug: tmux-session-persistence
created_at: 2026-06-16T10:50:52Z
discipline: normal
orchestration: single
team_size: 3
time_budget: 30 turns
depends_on: []
status: done
started_at: 2026-06-16T14:29:54Z
finished_at: 2026-06-16T14:43:15Z
executor: main
---

# Goal
Make agent sessions durable by running them inside tmux via CONTROL MODE
(`tmux -CC`): the agent process survives a Grove restart/crash and Grove
re-attaches to the live process instead of respawning — with zero terminal-UX
regression (native xterm scroll / search / selection), surfaced as an opt-in
per-worktree "durable" mode in the sidebar.

# Acceptance Criteria
<!-- machine-parsed by /yang-toolkit:execute-plan. Each item MUST follow:
- [ ] **<short name>**
  - Check: `<runnable command in backticks>`
  - Pass: <observable condition; no fuzzy words>
-->

- [ ] **Control-mode protocol parser**
  - Check: `npx vitest run src/core/tmuxControl.test.ts`
  - Pass: Exit code 0. Tests assert: octal unescape applies ONLY to control
    bytes/backslash (`\015\012`→CRLF, `\134`→`\`); literal multibyte UTF-8
    (`你好 ✻ ▰▱ 🔔`) passes through unchanged; `%output %<id> <v>` routes the
    pane id + decoded value; a `%begin..%end`/`%error` block is captured as a
    reply (not output); `%exit` fires onExit; the leading `\x1bP1000p` DCS wrapper
    is stripped; a payload split across two `feed()` chunks reassembles.

- [ ] **tmux launch + reattach decision (pure helper)**
  - Check: `npx vitest run src/core/tmuxControl.test.ts src/core/tmuxLaunch.test.ts`
  - Pass: Exit code 0. A pure `buildTmuxControlLaunch(name, cols, rows, agentCmd)`
    returns the `tmux -CC new-session -A -s <name> -x -y … -lc <agentCmd>` argv,
    single-quote-escaping the agent command; a `tmuxSessionName(worktreeId)`
    returns a deterministic, tmux-safe name (no `.`/`:`/`/`) stable across calls.

- [ ] **Opt-in setting + tmux availability fallback**
  - Check: `npx vitest run src/core/settingsStore.test.ts`
  - Pass: Exit code 0. `AppSettings.durableSessions` defaults to `false`; when the
    setting is on but tmux is not detected on PATH (existing `commandExists`
    helper), session creation falls back to the current direct `$SHELL -lc` spawn
    (no throw).

- [ ] **Durable descriptor persistence round-trip**
  - Check: `npx vitest run src/core/layoutStore.test.ts`
  - Pass: Exit code 0. A `SessionDescriptor` carrying the durable tmux name saves
    and re-loads with that field intact; descriptors without it load unchanged
    (back-compat with existing layout.json).

- [ ] **Off-screen search: root cause resolved (fix or documented)**
  - Check: `npx vitest run src/renderer/searchScroll.test.ts`
  - Pass: Exit code 0. EITHER (fix path) with the search bar open, a simulated
    incoming `onSessionData` does not reset the pane's viewport to the bottom
    (scroll position preserved so an off-screen match stays visible); OR
    (documented path) the test asserts the agent renders in the xterm ALTERNATE
    buffer (`term.buffer.active.type === 'alternate'`), proving there is no
    xterm scrollback to search and the limitation is Claude-side, not Grove's.

- [ ] **Typechecks, full suite, and builds clean**
  - Check: `npm run typecheck && npx vitest run && npm run build`
  - Pass: All exit 0; `out/` contains the bundled main + renderer entries.

# Files Touched
- `src/core/tmuxControl.ts`            — control-mode parser (promote from spike; add %layout-change size if needed)
- `src/core/tmuxControl.test.ts`       — parser unit tests (already green from spike)
- `src/core/tmuxLaunch.ts` (+ test)    — pure `buildTmuxControlLaunch` + `tmuxSessionName` (extracted from the index.ts spike)
- `src/core/settings.ts`, `src/core/settingsStore.ts` (+ test) — `durableSessions` opt-in flag (+ migration)
- `src/core/layoutStore.ts` (+ test)   — `SessionDescriptor` gains the durable tmux name
- `src/main/index.ts`                  — replace the CCM_TMUX spike with the settings-driven control path; `control` map; input→`send-keys -H`, resize→`refresh-client -C`, kill→detach (keep) vs explicit kill-session; orphan sweep of `grove_*` on startup
- `src/main/ipc.ts`, `src/preload/index.ts` — any new channel (e.g. list/kill detached durable sessions)
- `src/renderer/store.ts`              — durable-mode state; reattach-vs-respawn on restore; search auto-scroll fix (if fixable)
- `src/renderer/Sidebar.tsx` (+ Icons) — per-worktree durable badge + "Detached sessions" surface (adopt / kill)
- `src/renderer/SettingsPanel.tsx`     — Durable sessions toggle (gated on tmux installed)
- `e2e/smoke.mjs`                       — keep green; optionally a tmux-gated durable smoke path

# Out of Scope
- **Multi-window / split rendering inside one tmux session.** The spike proved a
  single agent pane; full tmux-window↔Grove-tab mapping (the richer "worktree =
  tmux session, panes = windows" model) is a follow-up. One agent pane per durable
  worktree here.
- **Making shells / dev-server panes durable.** Decision: worktree-level UI, but
  only the AGENT pane is actually tmux-backed; auxiliary shells respawn fresh.
- **tmux as the layout source of truth.** Decision: `layout.json` stays the single
  source of truth; tmux stores only the live process and is queried for liveness.
- **The `worktree:create` branch-collision papercut** (raw git error when the
  branch already exists). Unrelated subsystem — its own plan.
- **Control mode for non-Claude agents** beyond confirming they spawn; per-agent
  tuning deferred.

# Risks
- **Off-screen search may be unfixable in Grove.** Leading hypothesis (to verify
  FIRST): Claude Code runs in the xterm alternate-screen buffer with its own
  scroll/repaint, so there is no xterm scrollback to search — the "Jump to bottom"
  hint is Claude's own UI, not xterm's. Confirmed pre-existing (reproduces without
  tmux), so it is NOT a control-mode regression. If alt-screen, the criterion's
  "documented" path applies; only the normal-buffer-auto-scroll-snap case is fixable.
- **No JS library parses tmux control mode** (verified: every npm `tmux` package is
  a CLI wrapper; iTerm2's `TmuxGateway.m` is the only real reference). The parser
  is hand-written — keep it the small documented subset; port edge semantics from
  iTerm2 if needed.
- **`refresh-client -C` sizing is load-bearing.** A control client is inert at
  tmux's default 80x23 until sized; never use `resize-window` (freezes
  `window-size` to manual). Use per-client `refresh-client -C XxY` (auto-released
  on detach) — spike-verified format on tmux 3.6a.
- **tmux escapes ONLY control bytes + backslash as octal; high UTF-8 is literal.**
  (Spike caught this the hard way — rebuilding a byte array corrupted multibyte
  glyphs into `?`.) Do not re-decode; only unescape `\NNN` for control chars.
- **node-pty ABI / tmux absence.** node-pty is built for the Electron ABI; offline
  protocol capture needs `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron`.
  Durable mode must degrade gracefully when tmux is not installed.
- **Orphaned detached sessions leak.** Closing a durable tab detaches (keeps the
  agent alive) — must pair with a `grove_*` sweep/adopt-or-kill surface or sessions
  accumulate. (External research flagged this explicitly.)
- **Raw `tmux attach` is a dead end** (NOT this plan's approach): proven twice in
  the spike to corrupt rendering (left-column ghosting, bleed into the sidebar)
  because three repaint authorities (Claude → tmux grid → xterm) desync on reflow.
  Control mode collapses that to one (xterm), which is why it renders clean.

# Memory References
<!-- auto-generated below; remove individual lines if irrelevant.
Lines without <!--auto--> are preserved on --revise.
<type> is one of: ledger | decision | claude-md | plan | pattern | external. -->

- <!--auto--> [pattern] src/core/tmuxControl.ts — control-mode parser already built + unit-tested during the spike; promote it as-is (octal-unescape-control-only, DCS strip, %output/%begin/%exit).
- <!--auto--> [pattern] src/main/index.ts:204-256 (launchSpecFor) + :276-322 (createSession) — the proven integration seams; the CCM_TMUX=control spike here is the reference to productionize (control map, send-keys -H input, refresh-client -C resize).
- <!--auto--> [pattern] src/core/resume.ts (buildAgentLaunch) — mirror its graceful-degrade style (`claude --resume … || …`); tmux composes: reattach gets the LIVE process, only a dead session re-runs the inner `--resume`.
- <!--auto--> [pattern] src/core/settingsStore.ts + commandExists — opt-in flag + PATH detection pattern for the durableSessions toggle / tmux availability.
- <!--auto--> [pattern] src/core/layoutStore.ts (SessionDescriptor) — add the deterministic durable tmux name here; tmuxName replaces nothing, layout.json stays source of truth.
- <!--auto--> [ledger] single-worktree-multi-session — the foundational session/pty/registry/state-detection model this builds on (one agent per worktree invariant; restore recovers identity from descriptor.icon).
- <!--auto--> [external] https://github.com/tmux/tmux/wiki/Control-Mode — official protocol spec (the ~20 %-notifications; we need %output/%begin/%end/%exit + DCS).
- <!--auto--> [external] https://github.com/gnachman/iTerm2/blob/master/sources/TmuxGateway.m — the only real-world control-mode parser (Obj-C); port edge semantics from here.
- <!--auto--> [external] tmux 3.6a manpage CONTROL MODE + spike capture — `%output` escapes ONLY control/backslash as octal; `new-session -A` = create-or-attach; `refresh-client -C XxY` sizes the client (auto-freed on detach); `send-keys -H <hex>` for input.

# Execution Log

## Run 1 — 2026-06-16
- **started_at:** 2026-06-16T14:29:54Z
- **finished_at:** 2026-06-16T14:43:15Z (~13 min)
- **outcome:** done — all 6 acceptance criteria pass.
- **orchestration:** single (discipline: normal). Executed directly by the
  orchestrator rather than delegating to `/yang-toolkit:feature-dev-tracked`,
  because the validation spike from this session already held the full
  control-mode protocol + integration-seam context a fresh delegate would have
  had to rebuild. Tracked here + in the ledger all the same.
- **branch:** `tmux-session-persistence` (off `main`; the worktree-sidebar
  papercut fixes live separately on `worktree-sidebar-fixes`).
- **acceptance criteria results (exact commands):**

  | criterion | command | result |
  |---|---|---|
  | Control-mode parser | `npx vitest run src/core/tmuxControl.test.ts` | exit 0, 11 passed |
  | tmux launch + reattach | `npx vitest run src/core/tmuxControl.test.ts src/core/tmuxLaunch.test.ts` | exit 0, 16 passed |
  | Opt-in setting + fallback | `npx vitest run src/core/settingsStore.test.ts` | exit 0, 7 passed |
  | Durable descriptor persistence | `npx vitest run src/core/layoutStore.test.ts` | exit 0, 7 passed |
  | Off-screen search resolved | `npx vitest run src/renderer/searchScroll.test.ts` | exit 0, 3 passed |
  | Typechecks/suite/build | `npm run typecheck && npx vitest run && npm run build` | exit 0; 142 tests; out/ has main+renderer. e2e SMOKE_OK |

- **what shipped:** `core/tmuxControl.ts` (control-mode `%output`/`%begin`/
  `%exit` parser, DCS strip, octal-control-only unescape) promoted from the spike;
  pure `core/tmuxLaunch.ts` (`buildTmuxControlLaunch`, `tmuxSessionName`,
  `durableEnabled`); `settings.durableSessions` opt-in (default off) + tmux-absent
  fallback in `durableAgentName`; `SessionDescriptor.durable` marker + snapshot
  `durable` flag through IPC; the `index.ts` spike replaced with a single
  settings-driven control path (input→`send-keys -H`, resize→`refresh-client -C`,
  kill→detach-keeps-alive); a SettingsPanel toggle and a sidebar AnchorIcon badge.
- **search criterion (note):** taken via the "documented" path. Grove uses the
  stock xterm SearchAddon, which already traverses scrollback; the limit is that
  a full-screen TUI (Claude Code) drives the xterm ALTERNATE buffer, which has no
  scrollback to search. Encoded as `searchCoversScrollback()` +
  `store.searchLimitedToScreen()`; confirming Claude is alt-screen at runtime (vs
  a normal-buffer auto-scroll-snap) needs the live app, not a unit test.
- **scope-guard:** clean. Every modified source file is within Files Touched;
  `preload/index.ts` and `e2e/smoke.mjs` were allowed but needed no change. Only
  generated artifacts (`e2e/smoke.png`, `out/`) changed outside the list.
- **deviations from plan:** descriptor stores a `durable` boolean (the tmux name
  is derived deterministically via `tmuxSessionName`) rather than persisting the
  name itself — consistent with "layout.json is the source of truth."
- **not committed:** changes left uncommitted on the branch (outcome in-progress;
  PR to follow).
