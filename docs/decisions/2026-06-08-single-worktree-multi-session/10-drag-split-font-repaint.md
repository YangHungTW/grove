# 10 — Draggable splits, terminal font, and TUI repaint-on-reshow fix

## Draggable split panes
The pane grid now uses per-column/per-row fraction arrays (`colFr`/`rowFr`) instead
of `repeat(N, 1fr)`. Absolutely-positioned `.gutter` handles sit on the column/row
boundaries; dragging one redistributes the two adjacent fractions live, and on
mouseup the grid is re-laid-out (gutters repositioned + terminals refit). Fractions
reset to equal whenever the grid shape (pane count) changes.

## Font (user-reported)
xterm had no `fontFamily`, so it used a non-monospace default and powerline/Nerd
glyphs rendered as tofu. Set
`fontFamily: '"MesloLGS NF", "MesloLGS Nerd Font", Menlo, Monaco, "Courier New", monospace'`
(MesloLGS NF is powerlevel10k's recommended font; falls back to Menlo).

## Agent "disappears" on project switch (user-reported)
Root cause: NOT session loss — the E2E confirms the session + sidebar row persist
across project switches (`agentAfterSwitch=1`). Real claude is a full-screen TUI on
the **alternate screen**; when its pane is `display:none` and re-shown, xterm's
canvas is cleared but claude only repaints on SIGWINCH, so the pane looked blank.
Fix: `fitVisible` tracks newly-shown panes and nudges their size (rows → rows-1 →
rows) to force a SIGWINCH and repaint. A plain shell keeps its visible buffer, which
is why the E2E with a shell agent didn't catch it.

## Verification
- Unit 28/28; typecheck + build exit 0.
- E2E: `dragResize=true` (drag the column divider widens col 0),
  `agentAfterSwitch=1` (project switch preserves the agent), plus all prior checks.

## Still open
- Persist split fractions + active worktree/project across relaunch.
- State-detection (busy/waiting dots) polish under shell-wrapped agents.
