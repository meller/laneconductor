# Spec: Worker identity should be 1:1:1 with pid and track

## Problem Statement

The `workers` table models one worker as one row with a single `current_task`/`status`/`pid`,
upserted by `updateWorkerHeartbeat()` keyed on `(hostname, project_id, worker_number)`
(`conductor/laneconductor.sync.mjs:325`). But a single worker process can run several lane
actions concurrently — `autoLaunchLocalFs`'s claim loop allows up to a lane's own
`parallel_limit` (`runningPids.size >= globalLimit` gate, line 7485) — and every concurrent
claim calls the same `updateWorkerHeartbeat('busy', <task label>)` (line 6034), so the second
claim's heartbeat silently overwrites the first claim's `current_task`. The underlying work is
correct — both processes run independently to completion — but the Workers panel can only ever
show one of them, with no indication a second is running at all.

Confirmed live: livingwork's single registered worker (worker_number 1, PID 2497712) had two
independently-alive `claude` child processes — PID 2543621 running `implement 1018`, PID
2495470 running `implement 1019` — running simultaneously under `parallel_limit: 2`. The
`workers` row showed only `current_task: "local-fs-implement track 1018"`; AM-1019's own
concurrent run was invisible to anyone looking at that panel.

## Requirements

- REQ-1: Every live, running lane-action process has its own distinct row in the `workers`
  table, showing exactly that one process's `pid`, `status`, and `current_task` (its own
  track/action) — never sharing a row with a sibling concurrent claim.
- REQ-2: The already-existing per-process identity (`workerNumber`, fixed at process startup,
  woven into the lock file path, token store path, and pid file path — confirmed at
  `conductor/laneconductor.sync.mjs:142,257,1049,1895`) is NOT changed by this track. Those
  paths coordinate cross-process concerns (git locks, auth tokens, supervisor pid tracking)
  that have nothing to do with how many tracks this one process is concurrently juggling —
  touching them is out of scope and a materially different, riskier change.
- REQ-3: The claim-scoped worker identity introduced for REQ-1 is additive and DB/UI-facing
  only. It piggybacks on bookkeeping that already exists in-memory for every concurrent
  claim — `runningPids` (Set of live child pids), `runningLaneMap` and `runningTrackMap` (both
  keyed by `proc.pid`, already recording exactly which lane/track each concurrent child is
  running — see `conductor/laneconductor.sync.mjs:6117-6119`) — rather than inventing a
  parallel tracking mechanism.
- REQ-4: The first/only concurrent claim continues to use the process's own existing
  `workerNumber` row exactly as today — REQ-1 only requires ADDITIONAL rows to appear once a
  second (or further) concurrent claim is live under the same process. The common,
  overwhelmingly frequent case (one process, one thing running at a time) must show zero
  behavior change.
- REQ-5: When a concurrent claim's process exits (`proc.on('exit', ...)`, line 6148), its
  claim-scoped worker row is retired (removed, or set idle) independently of any sibling
  claim's own row — exiting claim B must never affect claim A's still-running row.
- REQ-6: A claim-scoped worker row that never got a chance to retire cleanly (the owning
  process crashed, or was killed, without running its exit handler) must be detectable and
  reconcilable by the same class of orphan-detection this codebase already applies to regular
  worker rows — it must not sit forever falsely showing `busy` for a pid that no longer exists.
- REQ-7: Explicitly OUT of scope — genuine subagents (Task-tool orchestration inside a single
  CLI turn's own internal tool use, e.g. the manager's own conversational turns fanning out to
  parallel Task calls) are not workers in this sense and get no rows from this track. This
  track only concerns `laneconductor.sync.mjs`'s own concurrent lane-action claim loop.

## Acceptance Criteria

- [x] A real project with a lane `parallel_limit >= 2` and two tracks queued in that lane, both
      claimed and running concurrently by the same worker process, shows TWO rows in the
      Workers panel — each with its own correct pid and current_task naming its own track —
      not one row and one invisible task.
- [x] Stopping/finishing one of the two concurrent tracks removes (or idles) only that one's
      row; the other concurrent track's row is untouched and keeps reporting correctly.
- [x] A single-claim run (the common case: one process, one track at a time) is observably
      unchanged — same row, same worker_number, same lock/token/pidfile paths as before this
      track.
- [x] Killing a concurrent claim's child process out from under the worker (simulating a crash)
      results in that claim's row eventually being reconciled (removed or marked offline/idle),
      not left forever claiming `busy` on a dead pid.
- [x] No change in behavior for manager-driven subagent orchestration (Task-tool calls within
      one CLI turn) — confirmed by not touching any code path outside
      `autoLaunchLocalFs`'s/`spawnCli`'s concurrent-claim handling.

## Data Model Changes

To be finalized in planning/implementation — the two live options, in order of preference:

1. **Extend `worker_number` semantics**: allocate a derived, per-claim `worker_number` (e.g.
   the process's own base `workerNumber` for the first claim, then on-demand values for
   additional concurrent claims, drawn from a small pool sized to the largest configured
   `parallel_limit` and released back to the pool on claim exit). Reuses the EXISTING
   `(hostname, project_id, worker_number)` upsert key with no schema change — the simplest
   option if a clean, race-free allocation scheme can be found.
2. **A new claim-scoped table/column** (e.g. `worker_claims`, or a `parent_worker_id` +
   `claim_pid` pair on `workers` itself) if option 1's allocation turns out to race or collide
   under real concurrent-claim timing. Needs its own migration.

Planning should validate option 1 against real claim/release timing before committing to it;
fall back to option 2 only if option 1 cannot be made race-free.
