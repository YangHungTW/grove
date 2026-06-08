# 11 — cmux-style UI/UX overhaul

User feedback: "cmux 的 ui/ux 比較好". Adopted all four directions they picked.

## 1. Tabs + on-demand split
Pane area now has a **tab bar** (one tab per session of the active worktree) plus a
toolbar. Default is **single** — only the focused session shows full-screen; a
`⊟ split` / `◳ single` toggle (⌘D) tiles all sessions in the existing draggable
grid. Clicking a tab focuses (and, in single mode, shows) that session. This
replaces the old always-tiled behaviour, which felt cramped.

## 2. Notification system
- `dot-waiting` gets a glow; the tab and sidebar row get an attention ring when a
  session needs input and isn't focused.
- Toolbar **🔔 with a count badge**; clicking it (or **⌘⇧U**) jumps to the most
  recent session needing attention — switching project/worktree/tab as needed.
- Driven by the existing `detectState` (agent='claude') waiting classification.
- Note: not covered by E2E (needs a real agent emitting a waiting prompt to be
  deterministic); wired and verifiable manually.

## 3. Richer sidebar metadata
- **`worktreeStatus()`** (TDD, +2 tests) → `worktree:status` IPC. Sidebar shows a
  per-worktree badge: `●dirty ↑ahead ↓behind`.
- Each session row shows its **state** (idle/busy/waiting/exited) and the **last
  output line** (captured from pty data, ANSI-stripped, throttled).
- Deferred: PR status and listening ports (need gh/process scanning).

## 4. Visual polish
Full CSS pass: SF/system font, tighter spacing + hierarchy, rounded controls,
hover/active states, tab styling with active underline, glowing waiting dot, toast
slide-in, consistent accent/danger palette.

## Verification
- Unit **30/30** (added worktreeStatus tests); typecheck + build exit 0.
- E2E updated for the new model and green:
  `projects=2 split=2 dragResize=true roundTrip=true worktreeCreated=true `
  `agentLaunched=true singleAgent=true agentAfterSwitch=1 kbdNav=true restored=3`
  (tabs render, single-by-default → 1 pane, split toggle → 2, drag works,
  re-clicking +agent focuses instead of erroring, restore shows tabs).

## Still open
- Persist split mode + split fractions + active worktree across relaunch.
- PR status / listening ports in the sidebar.
- Bundle a Nerd Font so powerline glyphs render without a system MesloLGS NF.
