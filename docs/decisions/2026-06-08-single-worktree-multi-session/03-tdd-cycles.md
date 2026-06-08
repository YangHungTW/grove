# 03 — TDD Cycles

| # | test name                                            | red ts            | green ts          | refactored?                          |
|---|------------------------------------------------------|-------------------|-------------------|--------------------------------------|
| 1 | `SessionRegistry` — N sessions, single agent (6)     | 2026-06-08T03:25Z | 2026-06-08T03:25Z | no — clean as written                |
| 2 | `PtySession` — data/kill/resize lifecycle (3)        | 2026-06-08T03:26Z | 2026-06-08T03:27Z | no — event fan-out kept minimal      |
| 3 | `worktree` — create/list/remove vs temp repo (3)     | 2026-06-08T03:27Z | 2026-06-08T03:27Z | no — porcelain parser covers cases   |
| 4 | `detectState` — waiting/busy/idle + fallback (4)     | 2026-06-08T03:28Z | 2026-06-08T03:28Z | no — rules already data-driven       |

**Totals:** 4 cycles, 16 tests, all green. Core engine (`src/core/*`) complete.

Remaining work (Electron wiring) is validated by acceptance criterion 5
(`typecheck && build`), not by unit tests — IPC/renderer are integration glue,
not unit-testable logic. Written as production code, gated on the build.
