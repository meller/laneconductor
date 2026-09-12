# Spec: Automated test coverage for `lc` move-family lane-change behavior

## Problem Statement

`bin/lc.mjs`'s move-family command — one shared code branch at
`command === 'move' || ['plan','implement','review','quality-gate','backlog','done','pulse','rerun'].includes(command)`
(bin/lc.mjs:2962) — has **zero** automated test coverage. Two real, live bugs were
found and fixed in exactly this branch on 2026-09-11, and neither shipped with a
regression test:

1. **Prefixed folders were invisible** (fixed in `ac5dd70a`). The branch resolved a
   track's folder with a naive `readdirSync(...).find(d => d.startsWith(trackNum + '-'))`
   scan, which only ever matched bare `NNN-slug` folders and silently missed every
   `INITIALS-NNN-slug` one — the shape every affected track actually used. `lc plan 1003`
   either errored "Track not found" or matched an unrelated folder. The fix switched to
   the canonical `resolveTrackFolderFs` resolver and normalized either identifier form
   (bare `1003` or prefixed `AM-1003`) to the bare number early, so folder resolution,
   the session-invalidation URL, and the dispatched slash command all agree with the
   DB's never-prefix-qualified `track_number`.

2. **Stale sessions survived a lane change** (fixed in `47fa2c59`). `resolveTrackSession()`
   keys a track's persisted Claude session purely by track number, with no lane/action
   awareness. Re-queuing an already-done track back to `plan` let the worker `--resume` a
   session whose entire conversational memory was "I already finished this" — the resumed
   turn re-asserted that conclusion and round-tripped QUEUE→RUN→done in seconds with zero
   file changes (confirmed live on livingwork tracks 1003, 1011-1023). The fix issues
   `DELETE /track/:num/session` to every enabled collector whenever the lane *actually*
   changes.

Both fixes were verified only by live manual testing and one throwaway scratch-directory
script. Worse, **only the `plan` alias was exercised at all** — the generic
`lc move <id> <lane>:<status>` form and every other alias (`implement`, `review`,
`quality-gate`, `backlog`, `done`, `rerun`, `pulse`) were never run, live or automated.
They share the branch so are very likely fine, but that is an assumption, not a fact.

## Solution

A real `node --test` suite — `conductor/tests/track-10092-move-family-cli.test.mjs` —
following this project's established patterns (a throwaway fixture project, the real `lc`
CLI spawned as a child process, `conductor/tests/mock-collector.mjs` for the collector
side), asserting both fixes and the untested invocation forms.

## Requirements

### Folder resolution
- **REQ-1**: A prefixed `INITIALS-NNN-slug` folder resolves when invoked with the **bare**
  number (`lc plan 10092`), and the markers are written into that folder's `index.md`.
- **REQ-2**: The same folder resolves when invoked with the **prefixed** identifier
  (`lc plan AM-10092`), and stdout reports the **bare** number.
- **REQ-3**: A legacy bare `NNN-slug` folder still resolves — no regression from the
  resolver swap.
- **REQ-4**: A sibling folder that merely *contains* the number as a substring
  (e.g. `AM-110092-other` for track `10092`) is never resolved or written to.

### Session invalidation
- **REQ-5**: A move that **actually changes** the lane issues `DELETE /track/:num/session`
  to the enabled collector, and the mock's stored session for that track is gone.
- **REQ-6**: The DELETE is addressed with the **bare** track number even when the command
  was invoked with the prefixed identifier — the URL must never carry `AM-10092`.
- **REQ-7**: An unrelated track's session in the same project is untouched.
- **REQ-8**: A **same-lane** invocation (`lc plan NNN` on a track already in `plan`,
  including a status-only change) issues **no** DELETE.
- **REQ-9**: `lc pulse NNN <status> <progress>` issues **no** DELETE, leaves `**Lane**`
  untouched, and updates `**Lane Status**` / `**Progress**`.

### Invocation-form coverage
- **REQ-10**: The generic `lc move <id> <lane>:<status>` form is exercised directly:
  both `**Lane**` and `**Lane Status**` are written, and the DELETE fires on a real lane
  change.
- **REQ-11**: At least one non-`plan` lane alias (`lc implement <id>`) is exercised
  directly and behaves identically — proving the shared branch, not just the `plan` path.

### Best-effort / degraded paths
- **REQ-12**: `mode: "local-fs"` issues no HTTP call at all; the index.md write still
  happens and the command exits 0.
- **REQ-13**: A collector marked `"enabled": false` receives no DELETE, while an enabled
  sibling collector does.
- **REQ-14**: An unreachable collector (connection refused) does not block or fail the
  move — the command still writes `index.md` and exits 0.

### Test-infrastructure
- **REQ-15**: `conductor/tests/mock-collector.mjs` records every
  `DELETE /track/:num/session` in a `sessionDeletes` array exposed via `GET /_state`, so a
  test can distinguish "no call fired" from "a call fired against the wrong key". This is
  **purely additive** — no existing mock behavior or response shape changes.
- **REQ-16**: The suite creates its fixture project under `os.tmpdir()` (never inside the
  repo or a worktree), spawns no worker process, and needs no database — so it cannot be
  redirected against the primary checkout the way worker-spawning tests can be.

## Acceptance Criteria

- [ ] `node --test conductor/tests/track-10092-move-family-cli.test.mjs` passes, run from
      a clean checkout with no worker and no database running.
- [ ] Reverting `ac5dd70a`'s resolver change (restoring the `startsWith` scan) makes the
      prefixed-folder cases fail — the suite actually pins the fix, verified by running it
      against the reverted code once during implementation.
- [ ] Reverting `47fa2c59`'s invalidation block makes the lane-change cases fail — same
      verification.
- [ ] The generic `lc move <id> <lane>:<status>` form and the `lc implement <id>` alias
      each have at least one directly-executed test; neither is covered only by inference
      from the `plan` path.
- [ ] Both negative cases (same-lane move, `lc pulse`) assert **zero** recorded session
      deletes, not merely that the session value survived.
- [ ] `node --test conductor/tests/local-api-e2e.test.mjs` still passes, proving the
      `mock-collector.mjs` addition broke no existing consumer.
- [ ] No orphaned processes remain after the run (`ps aux | grep -E 'mock-collector|laneconductor.sync'`
      is clean) — every spawned mock collector is killed in an `after` hook.

## Out of Scope (FFU — not deferred capability, genuinely not this track)

- Changing any production behavior in `bin/lc.mjs`. This track adds tests only; if a test
  uncovers a further bug, it gets its own track.
- Testing the `--run` / `-r` foreground-spawn path, which launches a real AI agent.
- Testing `lc rerun`'s retry-count reset and comment fan-out (a separate concern from
  lane-change behavior; its own branch within the same command).
- Per-worker session scoping (`sessionsByToken`). The CLI sends no bearer token in the
  local-api default configuration, so the flat `state.sessions` mirror is the correct
  assertion surface here.
