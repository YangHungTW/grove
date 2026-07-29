---
slug: sidebar-collapsible-projects
created_at: 2026-07-29T09:20:08Z
discipline: normal
orchestration: single
team_size: 3
time_budget: 25 turns
depends_on: []
status: done
started_at: 2026-07-29T09:32:52Z
finished_at: 2026-07-29T09:47:57Z
executor: main
---

# Goal
Let each project group in the sidebar be collapsed/expanded via a caret, with the
collapsed set persisted in `AppSettings` so it survives an app restart, plus a
Collapse all / Expand all control on the "Projects" section label.

# Acceptance Criteria

- [ ] **Per-project collapse toggles and persists**
  - Check: `npx vitest run src/renderer/store.test.ts src/core/settingsStore.test.ts`
  - Pass: exit code 0, and the run includes new tests asserting all of: (a)
    `toggleProjectExpand(repoRoot)` flips `ProjectView.expanded` from `true` to
    `false`; (b) that call invokes `window.api.settingsSave` with a patch whose
    `collapsedProjects` array contains `repoRoot`; (c) calling it again removes
    `repoRoot` from the persisted `collapsedProjects`; (d) a `Store` whose loaded
    settings contain `collapsedProjects: ['/x']` ends `init()` with project `/x`
    at `expanded === false`; (e) `DEFAULT_SETTINGS.collapsedProjects` deep-equals
    `[]` and `SettingsStore.load()` on a settings JSON written without the
    `collapsedProjects` key returns `collapsedProjects: []`.

- [ ] **Collapse all / Expand all**
  - Check: `npx vitest run src/renderer/store.test.ts`
  - Pass: exit code 0, and the run includes tests asserting that with 2 seeded
    projects, `collapseAllProjects()` leaves `expanded === false` on both and
    persists a `collapsedProjects` array containing both `repoRoot`s, and
    `expandAllProjects()` leaves `expanded === true` on both and persists
    `collapsedProjects: []`.

- [ ] **Selecting or reconciling a project does not silently re-expand it**
  - Check: `npx vitest run src/renderer/store.test.ts`
  - Pass: exit code 0, and the run includes a test asserting that after
    `toggleProjectExpand(r)` collapses project `r`, awaiting `setActiveProject(r)`
    leaves `projects.get(r).expanded === false`, and a subsequent
    `reconcileWorktrees()` pass also leaves it `false`.

- [ ] **Typecheck clean**
  - Check: `npm run typecheck`
  - Pass: exit code 0 with no `error TS` line in the output.

- [ ] **Built app collapses in the DOM and existing selectors survive**
  - Check: `npm run e2e`
  - Pass: exit code 0, with `e2e/smoke.mjs` extended to: click
    `.project-group .project-caret`, then assert that project group's
    `.worktrees .card` count is `0` while its `.project-name` and
    `.project-count` are still visible; click the caret again and assert the
    `.card` count returns to its pre-click value. The pre-existing assertions on
    `.project-group`, `.project-name` and sidebar resize must still pass
    unmodified.

# Files Touched
- `src/core/settings.ts`
- `src/core/settingsStore.test.ts`
- `src/renderer/store.ts`
- `src/renderer/store.test.ts`
- `src/renderer/Sidebar.tsx`
- `src/renderer/styles.css`
- `e2e/smoke.mjs`

# Implementation Notes

Not enforced by `/execute-plan`, but these are the grounded decisions behind the
criteria — the research found substantial dead scaffolding to reuse rather than
rebuild.

1. **Reuse `ProjectView.expanded`, do not add a `collapsed` field.**
   `ProjectView.expanded` (`src/renderer/store.ts:35`) and
   `toggleProjectExpand()` (`src/renderer/store.ts:663`) already exist but are
   read by nothing — leftovers of an accordion sidebar that was removed. Wire
   them up. Adding a *new* required field to `ProjectView` would break
   `src/renderer/store.test.ts:38` (`seedProject` builds the literal by hand).

2. **Persist as `collapsedProjects: string[]` in `AppSettings.`**
   Add the field at `src/core/settings.ts:133` (next to `sidebarCollapsed`) and
   `[]` in `DEFAULT_SETTINGS` (`src/core/settings.ts:184`). `SettingsStore.load`
   already spreads `DEFAULT_SETTINGS`, so existing settings files migrate for
   free. Storing the *collapsed* set (not the expanded one) means newly opened
   projects default to expanded with no write. Persist through the existing
   `updateSettings(patch)` path (`src/renderer/store.ts:1410`) — the same
   optimistic-merge-then-background-save shape as `toggleSidebar`
   (`src/renderer/store.ts:1407`).

3. **Remove the force-expand at `src/renderer/store.ts:673.`**
   `setActiveProject()` sets `p.expanded = true` ("select expands this one"), and
   `init()` (`src/renderer/store.ts:1570`) calls `setActiveProject` on the first
   project at boot — so a persisted collapse of that project would be undone
   before the user ever sees it. Delete the line. **Keep** the force-expand in
   `jumpToPending()` (`src/renderer/store.ts:1377`): that is an explicit
   attention jump, so landing on an invisible worktree would be a bug — and
   persist the resulting change so it stays consistent.

4. **UI: caret in `.project-header`, gate the sibling `.worktrees` div.**
   `ProjectGroup` (`src/renderer/Sidebar.tsx:28`) renders `.project-header` and
   `.worktrees` as siblings, so collapsing is a conditional render of the latter.
   Mirror the repo's only disclosure precedent, `DiffPane.tsx:266-273`: a
   `<button>` carrying `aria-expanded`, plus a chevron. Reuse `ChevronDownIcon`
   (`src/renderer/Icons.tsx:54`) with a CSS rotate rather than adding a new icon.
   The orphan `.caret` rules at `src/renderer/styles.css:416` are dead CSS from
   the old accordion and can be reclaimed.

5. **Counts stay visible when collapsed.** `.project-count`
   (`src/renderer/Sidebar.tsx:35`, styled at `src/renderer/styles.css:171`)
   already lives in the header and shows `project.worktrees.size`, so it survives
   collapse for free. Add an aggregated running/attention-session indicator
   beside it so a collapsed project still signals activity — sessions are not
   nested in the sidebar today (only counted, `src/renderer/Sidebar.tsx:112`), so
   this reads from `store.sessionsOf(wt.id)` across the project's worktrees.

6. **Collapse all / Expand all** goes on the `.section-label` "Projects" row
   (`src/renderer/Sidebar.tsx:20`), which is currently a bare `div` — make it a
   flex row with a single button that toggles based on whether any project is
   currently expanded.

# Out of Scope
- Full sidebar keyboard navigation / roving tabindex / arrow-key tree traversal.
  Only `aria-expanded` on the caret button is in scope (mirroring `DiffPane`).
- Auto-expanding a project when the user switches to a session inside it
  (`⌘1-9`, `cycleWorktree`, `switchProject`). Explicitly declined; only
  `jumpToPending` keeps its force-expand.
- Changing `cycleWorktree` / `switchWorktree` iteration
  (`src/renderer/App.tsx:29-122`) to skip collapsed projects — they continue to
  traverse every worktree regardless of visibility.
- Collapsing individual worktree cards or session groups.
- Per-project persistence via `src/core/projectStore.ts` — `ProjectEntry` /
  `ProjectPatch` stay untouched; collapse state lives in `AppSettings` only.
- The whole-sidebar collapse (`sidebarCollapsed`, `⌘B`) behaviour.
- The tab bar / `GroupTabs` rendering of sessions.

# Risks
- **This caret existed before and was deliberately deleted.** The ledger shows a
  per-project caret toggle landing 2026-06-08, then being replaced the same day
  by a cmux-style flat worktree-card redesign with a lightweight project group
  label. Re-adding it re-opens that design tension — keep the caret visually
  minimal (muted, small, hover-revealed if needed) so the flat-card look
  survives. No ledger entry is marked `failed`, so this is a design reversal, not
  a known-broken approach.
- **Live reconciliation may reset state.** `worktree-sidebar-fixes` (merged,
  `f4b4432`) added `reconcileWorktrees()` on a ~20s poll plus window focus, which
  rebuilds the worktree map underneath the project. Collapse state lives on
  `ProjectView` / settings rather than on worktrees, so it *should* survive — but
  this is exactly the class of bug `DiffPane.tsx:100-120` had to solve
  ("collapse state survives a Refresh"). Criterion 3 exists to pin it.
- **E2E selector coupling.** `e2e/smoke.mjs:76,86-90,93-94` and
  `e2e/resize-probe.mjs:33` wait on `.project-group` and count `.project-name`.
  Any DOM restructure of `.project-group` / `.worktrees` breaks the smoke test;
  default state must remain expanded so existing assertions hold.
- **No React component tests exist.** `vitest.config.ts` includes only
  `src/**/*.test.ts` (not `.tsx`) and there is no `@testing-library/*` dependency,
  so the caret's rendering is only verifiable through `npm run e2e`. Do not add a
  testing-library dependency to satisfy a criterion — criterion 5 covers the DOM.
- **Whole-app re-render.** `useStore` is a `useSyncExternalStore` over a version
  counter (`src/renderer/useStore.ts:5`), so every `notify()` re-renders
  everything. Collapse-all on many projects should issue one `notify()` and one
  `settingsSave`, not one per project.
- The `single-worktree-multi-session` ledger chain (~40 entries) is all
  `outcome: in-progress` and never closed. It owns `Sidebar.tsx` but is ambient
  umbrella state, not a real blocker — deliberately NOT added to `depends_on`.

# Memory References
<!-- auto-generated below; remove individual lines if irrelevant.
Lines without <!--auto--> are preserved on --revise.
<type> is one of: ledger | decision | claude-md | plan | pattern | external.
For [external], <path> is a URL. -->

- <!--auto--> [ledger] `single-worktree-multi-session` @ 2026-06-08T10:05Z (in-progress) -- direct prior art: added a per-project caret toggle + session-count badge; the exact feature being re-introduced.
- <!--auto--> [ledger] `single-worktree-multi-session` @ 2026-06-08T12:10Z (in-progress) -- and then REMOVED that caret tree in favour of flat cmux-style worktree cards; the design reversal to be careful about.
- <!--auto--> [ledger] `single-worktree-multi-session` @ 2026-06-09T04:10Z (in-progress) -- introduced `settingsStore` + `settings:load/save` IPC + `AppSettings.sidebarCollapsed`; the persistence foundation to extend.
- <!--auto--> [ledger] `worktree-sidebar-fixes` (merged, `f4b4432`) -- added `reconcileWorktrees()` on a 20s poll + window focus; mutates the list being collapsed.
- <!--auto--> [pattern] `src/renderer/DiffPane.tsx:67-120,266-273` -- the repo's only collapse/expand precedent: keyed collapsed `Set`, `aria-expanded` button, chevron, state preserved across data refresh.
- <!--auto--> [pattern] `src/renderer/store.ts:1407-1420` -- `toggleSidebar` + `updateSettings`: mutate → `notify()` → background `settingsSave` patch. The exact shape for a persisted UI-state action.
- <!--auto--> [pattern] `src/core/settings.ts:133,184` -- `sidebarCollapsed` / `DEFAULT_SETTINGS`; `SettingsStore.load` spreads defaults so old settings files migrate for free.
- <!--auto--> [pattern] `src/renderer/Sidebar.tsx:28-97` + `src/renderer/styles.css:145-199` -- the `ProjectGroup` JSX/CSS pair to extend; `.worktrees` is a sibling of `.project-header`, and `styles.css:416` `.caret` is reclaimable dead CSS.
- <!--auto--> [pattern] `src/renderer/store.ts:35,663,673,1377` -- vestigial `expanded` field, dead `toggleProjectExpand`, and two force-expand leftovers from the removed accordion.
- <!--auto--> [plan] `.claude/plans/single-worktree-multi-session.md` -- goal: cmux-style sidebar/tabs/splits over one worktree hosting many PTYs. Risk that bit: renderer/xterm.js long tail, not the dependency risks predicted.
- <!--auto--> [plan] `.claude/plans/worktree-diff-review.md` -- touches `Sidebar.tsx` + `store.ts`; its risk that bit was an invariant in the hand-rolled renderer surviving later features.
- <!--auto--> [decision] `docs/decisions/2026-06-08-single-worktree-multi-session/07-project-layer.md:20-23` -- documents the OLD accordion semantics ("selecting one collapses others", "clicking title selects+expands, no toggle-collapse") that this plan deliberately does not restore.
- <!--auto--> [claude-md] `CLAUDE.md:28` -- `src/renderer/` is React UI (store, panes, tabs, dialogs); verify with `npx vitest run` + `npm run typecheck` + `npm run e2e`.

# Execution Log
<!-- filled by /yang-toolkit:execute-plan post-hoc. Leave empty in draft. -->

## Run 1 — 2026-07-29

- **started_at**: 2026-07-29T09:32:52Z
- **finished_at**: 2026-07-29T09:47:57Z
- **duration**: ~15 min
- **outcome**: `done` — all 5 acceptance criteria pass
- **orchestration**: `single`, `discipline: normal` → `/yang-toolkit:feature-dev-tracked`
- **decision docs**: `docs/decisions/2026-07-29-sidebar-collapsible-projects/`
  (01-discovery, 02-architecture, 03-implementation, 04-review, 05-summary)

### Degraded / auto-resolved

- **`/goal` was unavailable in this session** — no such command in the plugin,
  no local command, not an available skill. Step 3's condition was assembled and
  printed (3174 chars, under the 4000 limit) but never issued; the criteria loop
  was driven manually instead. Effectively `--no-goal`, so `goal_turns` is null
  in the ledger.
- **`--auto` could not be enabled programmatically** — no tool exposes the
  session permission mode. Stated up front rather than proceeding as if auto
  mode were active.
- `depends_on` was empty; no cycle check needed, no deps ignored.

### Criteria

| # | Criterion | Check | Result |
| --- | --- | --- | --- |
| 1 | Per-project collapse toggles and persists | `npx vitest run src/renderer/store.test.ts src/core/settingsStore.test.ts` | pass (27) |
| 2 | Collapse all / Expand all | `npx vitest run src/renderer/store.test.ts` | pass |
| 3 | No silent re-expand on select/reconcile | `npx vitest run src/renderer/store.test.ts` | pass |
| 4 | Typecheck clean | `npm run typecheck` | pass (exit 0) |
| 5 | Built app collapses in the DOM | `npm run e2e` | pass (`projectCollapse=true`) |

Full suite: 255 passed / 36 files.

### Plan corrections found during execution

- The plan said to wire up the existing `expanded` field. Discovery found
  `upsertProject` seeds it `expanded: false` (`store.ts:636`), so wiring alone
  would have shipped every project collapsed. The seed now derives from the
  persisted collapsed set — which is also the complete rehydration path, since
  `init()` loads settings before constructing any project.
- The review phase found a defect the plan did not anticipate: `removeProject`
  never re-derived the persisted set, so collapse → close project → reopen the
  same folder came back collapsed. Fixed and regression-tested.

### Scope

`git status` shows exactly the 7 files in Files Touched. One observed deviation:
`e2e/smoke.png` is modified — a screenshot artifact rewritten by `npm run e2e`
itself, i.e. by criterion 5's own Check command, not a hand edit. No scope-guard
hook is wired in this repo, so this was verified by inspection.
