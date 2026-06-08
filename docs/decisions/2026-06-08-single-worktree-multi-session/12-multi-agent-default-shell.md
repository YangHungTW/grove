# 12 — Multiple agents per worktree, drop task/server, default shell = $SHELL

User feedback: a worktree should allow multiple agents; task/server kinds aren't
needed; shell should be the user's default shell (zsh).

## Changes
1. **Multiple agents per worktree.** Removed the single-agent invariant:
   `SingleAgentError` and the agent check are gone from `SessionRegistry`; the
   renderer no longer "focuses the existing agent" on re-click — `+ agent` always
   creates a new one. Sessions are numbered per kind (`agent`, `agent 2`, …) so
   duplicates are distinguishable.
2. **Dropped `task`/`server`.** `SessionKind` is now `'agent' | 'shell'`; sidebar
   shows only `+ agent` / `+ shell`.
3. **Shell = $SHELL.** `launchSpecFor` now spawns `$SHELL -il` (interactive login,
   e.g. zsh) for *every* session — like a real terminal tab, so the user's
   profile/aliases/p10k prompt apply. Agents additionally bootstrap their command.

## Verification
- Unit **29/29** (registry tests rewritten: multiple agents + mixed kinds; the
  reversed invariant is the key change). typecheck + build exit 0.
- E2E green: `multiAgent=true` (second `+ agent` creates a 2nd ★),
  `agentAfterSwitch=2` (both agents survive a project switch), `restored=4`
  (2 shells + 2 agents restored). Screenshot shows zsh/p10k prompts.

## Note
Removing the single-agent invariant reverses the original "1 agent + auxiliary
panes" safety model (docs 01–05): multiple agents may now edit the same worktree
concurrently and can conflict. That is the user's explicit choice (parallel-agent
workflow); conflict handling is out of scope.
