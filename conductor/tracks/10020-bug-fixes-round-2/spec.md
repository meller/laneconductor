# Spec: Bug fixes round 2

## Problem Statement

Follow-up sync-worker/dispatch reliability bugs found while dogfooding track 10018's merge
(2026-08-20).

### Bug 1 — orphan reconciliation only ever runs once per worker process

`reconcileOrphanedDispatches()` (`conductor/services/orphaned-dispatch.mjs`, wired at
`conductor/laneconductor.sync.mjs:1043`) is gated by `hasReconciledOrphanedDispatches`, so it runs
exactly once — immediately after that worker process's first successful registration.

If a worker restarts *while* a dispatched lane action is still genuinely running (the worktree's
`index.md` still reads `**Lane Status**: running`), that one-time check correctly finds nothing to
reconcile, sets the flag, and never runs again for the life of that process. When the CLI child
finishes minutes later, nothing is left to notice: the child is `detached: true` + `unref()`
(`laneconductor.sync.mjs:4597`, `:4680`), so it survives the worker restart, but `spawnCli`'s
`proc.on('exit')` handler lived in the memory of the now-replaced process and never fires. The
`worker_dispatch` row stays `claimed`, the DB's `tracks.lane_action_status` and the primary
checkout's `index.md` stay frozen at their pre-run values indefinitely — even though the
worktree's own `index.md` correctly shows the finished `done`/`success` state and is fully
committed.

Reproduced live: track 10018's quality-gate dispatch (`worker_dispatch` id 1588, `worker_id` 998)
finished successfully (worktree `index.md`: `Lane: done`, `Lane Status: success`, committed) but
sat stuck at `quality-gate:queue` in DB/primary for 5+ minutes with zero live process tracking it,
because worker 998's process had been replaced between claiming the dispatch and the CLI actually
exiting.

**Why the naive fix is wrong.** Simply calling `reconcileOrphanedDispatches()` on the existing 5s
`reconcileActiveDispatch` tick re-opens a bug this same track already fixed once: the agent doing
the lane work can transiently write a non-`running` `**Lane Status**` mid-session without having
exited (see `conductor/tests/track-10020-reconcile-premature-finalize.test.mjs` and the
`laneconductor.sync.mjs:7434` comment). `reconcileActiveDispatch()` defends against this with
`runningTrackMap`, which is authoritative *because* only `spawnCli`'s own exit handler removes
entries from it — but `runningTrackMap` is in-memory, and by definition is **empty for exactly the
orphans this track is about**. A periodic orphan reconcile therefore needs a liveness signal that
survives a worker restart.

### Bug 2 — dispatched lane actions showed as queued for their whole run *(already fixed — reference only)*

`checkDispatchInbox()`'s lane-action branch wrote `Lane Status: running` to the track's local
`index.md` when spawning a dispatched CLI but never PATCHed the DB's `lane_action_status` to match
(only the failure path patched the DB, reverting it). The UI showed a dispatched track as queued
for its entire run. Fixed on main in commit `0abfcf8` (`laneconductor.sync.mjs:7386`), mirroring
the failure branch and `claimQueuedTracks()`. **No further implementation needed** — this track
only adds the regression test that pins the fix in place (REQ-7).

## Solution

Two mechanisms, deliberately separate:

1. **A persistent run marker** — `conductor/.runs/<track_number>.json`, written by `spawnCli`
   immediately after the child spawns and removed by its exit handler. It records the child's pid
   (and pgid), the spawning worker's pid, the dispatch id/action, and `started_at`. Because it is
   on disk, a *replacement* worker process can ask the OS whether the previous process's CLI child
   is still alive — the cross-process equivalent of `runningTrackMap`.
2. **A periodic orphan-reconcile tick** that consults that marker (plus this process's own
   in-memory state) before deciding a claimed dispatch is finished.

The marker is also what makes a *third* stuck state recoverable: a CLI that dies without writing a
terminal `**Lane Status**` (crash, SIGKILL, OOM) currently leaves `running` on disk forever, which
`classifyOrphanedDispatch()` reads as "still running" and never closes out.

## Requirements

- **REQ-1 — Run marker written and removed.** `spawnCli` writes
  `conductor/.runs/<track_number>.json` (in the **primary** checkout, i.e. `process.cwd()`, next to
  `conductor/logs/`) at the same point it does `runningTrackMap.set(...)`, containing at minimum
  `{ pid, pgid, worker_pid, track_number, dispatch_id, action, command, started_at }`. Its
  `proc.on('exit')` handler removes the marker unconditionally (best-effort, same style as
  `releaseTrackClaim`). `conductor/.runs/` is gitignored.
  `dispatch_id` is `null` for non-dispatch spawns (auto-launch, chat) — the marker is still written,
  since liveness is useful for all of them.

- **REQ-2 — Liveness is checked, not assumed.** A pure helper decides whether a marker means "the
  CLI is still running": pid alive **and** the process still looks like the recorded command.
  `process.kill(pid, 0)` alone is not sufficient — pid reuse would make a long-dead run look live
  forever, permanently blocking reconciliation of that track. Command verification uses
  `ps -p <pid> -o args=` (Linux/macOS); if the command cannot be read at all, treat the marker as
  **not** live rather than blocking forever, and log it.

- **REQ-3 — Orphan reconciliation runs periodically.** `reconcileOrphanedDispatches()` keeps its
  immediate run after first registration, and additionally runs on its own interval, default 30s,
  overridable via `LC_ORPHAN_RECONCILE_POLL_MS` for tests. `hasReconciledOrphanedDispatches` is
  replaced by an in-flight re-entrancy guard so a slow tick never overlaps itself.

- **REQ-4 — A still-running orphan is never finalized early.** Within the periodic tick, a claimed
  dispatch is skipped when **any** of these hold:
  - its track is in this process's `runningTrackMap` (this process spawned it and it's alive),
  - its track is in `activeDispatch` (owned by `reconcileActiveDispatch()`, which must remain the
    single finalizer for this process's own dispatches — no double-PATCH race),
  - a live run marker exists for the track (REQ-2),
  - `claimed_at` is younger than a grace period (default 30s, `LC_ORPHAN_RECONCILE_GRACE_MS`) —
    covers the claim→spawn window, which includes git-lock acquisition and worktree creation and
    can legitimately take seconds before any marker exists.

- **REQ-5 — Crashed runs are closed out instead of hanging forever.** When a run marker exists and
  its process is **not** live, but the worktree's `**Lane Status**` still reads `running`, the
  dispatch is finalized as `failed` with `skipArtifactCopy` and `flagForHuman` set, and a
  `> **system**: ⚠️ ...` comment is posted to the track's `conversation.md` explaining that the CLI
  died without recording an outcome and the action should be re-run. This is threaded through
  `classifyOrphanedDispatch()` as a new optional `runnerExited` input.

- **REQ-6 — No behavior change when no marker exists.** For a dispatch with no run marker on disk
  (pre-existing dispatches from before this change, or a spawn that failed before the marker was
  written), classification is **exactly** today's: driven solely by the worktree's `**Lane Status**`,
  with `running` meaning "skip". No new speculative finalization.

- **REQ-7 — Bug 2 regression test.** A test asserts that a dispatched lane action PATCHes
  `lane_action_status: 'running'` to the collector at spawn time, so the already-shipped `0abfcf8`
  fix cannot silently regress.

## Acceptance Criteria

- [ ] A lane action dispatched to a worker, whose worker process is then replaced mid-run, is
      closed out on the board **without human intervention** within one reconcile interval of the
      CLI actually finishing: the card leaves its stale lane/`queue` state and shows the lane the
      run finished in, the DB's `lane_action_status` matches, and the primary checkout's `index.md`
      carries the worktree's finished state. (This is the live 10018 incident, reproduced and then
      not reproducible.)
- [ ] During that same scenario, while the orphaned CLI is **still running**, the track keeps
      showing as running for the full duration — it is not prematurely flipped to done/failed,
      including when the agent transiently writes a non-`running` `**Lane Status**` mid-session.
- [ ] A dispatched run whose CLI is killed outright (SIGKILL, never writes a terminal
      `**Lane Status**`) stops hanging in `running` forever: within one reconcile interval it is
      reported failed and a `⚠️` comment appears in the track's conversation telling the human the
      run died and the action needs re-running.
- [ ] A dispatch this worker process itself is currently running is never touched by the periodic
      orphan tick — `reconcileActiveDispatch()` remains its only finalizer, and no dispatch ever
      receives two conflicting outcome PATCHes.
- [ ] Existing dispatch behavior is unchanged for tracks with no run marker: the full existing
      suite (`conductor/tests/track-10020-*.test.mjs`, `track-1110-*`, `track-1117-*`,
      `local-api-e2e`, `auto-launch`) still passes.
- [ ] Dispatching a lane action shows the track as **running** in the UI for the whole run, not
      queued (bug 2, pinned by a regression test).

## Data Model Changes

None in Postgres. One new on-disk artifact:

```
conductor/.runs/<track_number>.json   # gitignored, primary checkout only
{
  "pid": 123456,          // spawned CLI child pid
  "pgid": 123456,         // process group (spawn used detached:true)
  "worker_pid": 99887,    // worker process that spawned it
  "track_number": "10020",
  "dispatch_id": 1588,    // null for auto-launch / chat spawns
  "action": "quality-gate",
  "command": "claude",
  "started_at": "2026-08-27T10:00:00.000Z"
}
```

## New Modules / Env Vars

| Thing | Purpose |
|-------|---------|
| `conductor/services/run-marker.mjs` | Pure: marker path, serialize/parse, `isRunMarkerLive({ marker, isPidAlive, readProcessCommand })` |
| `LC_ORPHAN_RECONCILE_POLL_MS` | Test-only override of the 30s periodic orphan tick |
| `LC_ORPHAN_RECONCILE_GRACE_MS` | Test-only override of the 30s `claimed_at` grace period |

## Out of Scope

- Reconciling dispatches claimed by a **different** worker id (a worker that never comes back at
  all). The existing `dispatch-reaper` in `ui/server/index.mjs` owns the unclaimed case; the
  never-returning-claimed case is a separate, server-side problem.
- Changing `classifyOrphanedDispatch()`'s existing lane/action mismatch logic (tracks 10014/1117).
