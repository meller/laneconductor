# Spec: Board Shows `queue` While Lane Action Is Actively Running

## Problem Statement

A lane action can be genuinely running — real CLI child process alive, run marker on disk,
log growing — while `tracks.lane_action_status` in the DB reads `queue`, so the Kanban card
renders as idle-in-queue for the entire run. Observed live on 2026-08-30 across tracks 10039
(dispatch 2848) and 10040 simultaneously, for 6+ minutes each.

The user-visible consequence is worse than cosmetic: a card that reads `queue` is an
*invitation to press ▶ again*. Anything that trusts DB run-state — the auto-launch loop, the
`/tracks/running` concurrency check, manual dispatch, and (per track 10039 REQ-6) the coming
dispatcher modes — sees a free track and can start a second run on top of the live one.

### Why the incident looked contradictory

The incident report noted fresh `last_heartbeat` alongside `lane_action_status = 'queue'`,
which reads like two independent bugs. It is one. `POST /track` — the ordinary FS→DB push —
sets `last_heartbeat = NOW()` in the same upsert that writes `lane_action_status`
(`ui/server/index.mjs:2776`). So a push carrying a stale `queue` from a file refreshes the
heartbeat *while* clearing the running state. Fresh heartbeat + `queue` is the signature of
a file-sourced overwrite, not of a dead process.

## Root Cause

Three defects, one shared shape: **something clears `running` without asking whether a run is
actually alive, and nothing anywhere can put it back.** Each was confirmed by reading the code
paths named below; Phase 1 reproduces each as a failing test before anything is changed.

### Finding A — startup filesystem reset has no liveness check (primary cause)

`resetFilesystemRunningStatus()` (`conductor/laneconductor.sync.mjs:2864-2876`) runs
unconditionally at worker startup and rewrites `**Lane Status**: running` → `queue` in
**every** track's `index.md`, with no ownership or liveness check whatsoever. Its premise is
in the comment: *"worker owns no PIDs yet"* — true of the starting process, false of the
machine. Any worker start (a restart, a second `lc worker start`, or one of the leaked
processes track 10045 documents) wipes the `running` marker of tracks another process is
actively running.

Track 10020 already built the exact primitive this needs and this function does not use it:
`conductor/.runs/<track>.json` run markers, written unconditionally by `spawnCli` for every
spawn path (`sync.mjs:5022-5037`), removed on exit including kill/crash (`5051-5057`), and
readable cross-process via `isRunMarkerLive`/`isPidAlive` (`conductor/services/run-marker.mjs`).

### Finding B — startup DB reset is scoped per worker identity, not per process

`resetStuckActions(true)` → `POST /tracks/reset-stuck-actions {immediate:true}`
(`ui/server/index.mjs:3248-3278`) resets `lane_action_status` to `queue` with
`lane_action_result = 'stuck_timeout'`. Track 1117 Bug 1 narrowed it from project-wide to
`claimed_by = $machine_token`, which stops one worker stomping a *different* worker.

It does not stop a worker stomping *itself*: `machine_token` identifies a worker **row**, not
a **process**, and worker #1 reads it straight out of the shared `.laneconductor.json`
(`sync.mjs:986`). Every duplicate process of the same worker presents the same token, so
`claimed_by` matches and a sibling's live claims are reset. This is the DB-side twin of
Finding A and fires in the same instant.

### Finding C — nothing can heal it

`POST /tracks/heartbeat` (`ui/server/index.mjs:2959-2984`) gates its UPDATE on
`WHERE ... lane_action_status = 'running'`. The worker POSTs `runningTrackMap`'s contents every
5s (`sync.mjs:2882-2894`) — it knows the ground truth continuously — but the endpoint can only
refresh a timestamp on a row that is *already* `running`. Once the status is wrong it stays
wrong for the whole run. There is no path anywhere from "this worker has a live child for
track N" to "the DB says running".

Once the file says `queue`, every later `syncTrack()` (chokidar on `index.md`/`plan.md`/
`conversation.md`, `replayStaleTracks`) re-asserts it (`sync.mjs:2354-2355`), so the wrong
value is actively maintained rather than merely left behind.

### Finding D — auto-complete never writes `running` to the DB at all

`startNextAutoCompleteStage()` (`sync.mjs:6317-6323`) writes `Lane Status: running` to
`index.md` and spawns, but never patches the DB — the precise gap commit `0abfcf8` fixed for
`checkDispatchInbox` on 2026-08-20 and never applied to track 1114's auto-complete path. Every
"Complete & Merge" stage therefore shows `queue` in the UI until some unrelated `syncTrack()`
happens to push the file's `running`. Independent of the incident; same symptom; fixed here
because it is the same one-line parity.

### Relationship to track 10045 (answering the open question in `conversation.md`)

Shared trigger, independent defects. 10045's leaked worker processes are what made Finding A
and Finding B fire dozens of times on 2026-08-30 instead of once at a deliberate restart. But
both findings are bugs at a *single* legitimate restart too — restarting the worker while a
lane action is live is an ordinary thing to do. Fix them separately: 10045 stops the
duplicates; this track makes run-state correct even when duplicates exist. Neither blocks the
other.

## Requirements

- **REQ-1** — The startup filesystem reset must not clear `**Lane Status**: running` for a
  track with a live run marker. It resets only tracks whose `conductor/.runs/<track>.json` is
  absent, unparseable, or refers to a dead PID (`isRunMarkerLive`). Applies in every mode,
  including `local-fs`, where the file is the only source of truth.
- **REQ-2** — The startup DB reset (`immediate: true`) must not clear a claim whose run is
  still live on this machine. The worker sends the set of track numbers with live run markers;
  the server excludes them from the reset UPDATE. `machine_token` scoping (track 1117 Bug 1)
  stays exactly as it is — this narrows it further, never widens it.
- **REQ-3** — The 5s track heartbeat must repair a wrongly-cleared status: for tracks the
  worker holds in `runningTrackMap`, a DB row reading `queue` is set back to `running`. The
  repair is deliberately narrow — it fires **only** on `queue`, never on a terminal status
  (`success`/`failure`), so it can never resurrect a run the exit handler has already
  finalized.
- **REQ-4** — Every repair under REQ-3 logs at `warn` with the track number. A heal firing is
  evidence of a live bug upstream; it must never be silent, or this fix hides the next
  regression instead of surfacing it.
- **REQ-5** — Every reset under REQ-1/REQ-2 logs which tracks it cleared and which it skipped
  as live, so a stuck-forever-running track is still diagnosable from the log alone.
- **REQ-6** — `startNextAutoCompleteStage` patches `lane_action_status: 'running'` to the DB at
  spawn, matching `checkDispatchInbox` (`sync.mjs:7857`), including the same non-fatal
  `.catch()` on failure.
- **REQ-7** — No regression to genuine stuck-run recovery: a track whose CLI actually died must
  still return to `queue` via the existing non-immediate 2-minute heartbeat-staleness sweep.
  Guarding on liveness must not become "never reset anything".

## Acceptance Criteria

Each criterion is an observable outcome, not a code shape.

- [ ] **AC-1** — With a lane action running, the Kanban card reads `running` continuously for
      the whole run. Verified against the real UI/API, not only in unit tests.
- [ ] **AC-2** — Starting a second worker process while a lane action is live leaves that
      track's card on `running`. Before the fix this flips it to `queue` within one startup.
- [ ] **AC-3** — The same holds on disk: the live track's `index.md` still reads
      `**Lane Status**: running` after a second worker starts.
- [ ] **AC-4** — A track whose CLI process is genuinely dead is still reset to `queue` by the
      same startup pass that skipped the live one — in the same run, proving the guard
      discriminates rather than disables (REQ-7).
- [ ] **AC-5** — Given a DB row wrongly reading `queue` while the worker holds the track in
      `runningTrackMap`, the row reads `running` again within one heartbeat interval (5s), and
      a `warn` log names the healed track (REQ-3, REQ-4).
- [ ] **AC-6** — The heal does not fire against a track whose status is `success` or `failure`:
      a finished run stays finished.
- [ ] **AC-7** — When a run completes normally, the card leaves `running` — no
      stuck-forever-running introduced by any of the above.
- [ ] **AC-8** — A "Complete & Merge" auto-complete stage shows `running` in the UI from spawn,
      without waiting for an incidental file sync (REQ-6).

## Out Of Scope

- The duplicate-worker-process leak itself — track 10045.
- The ~90s duplicate-dispatch double spawn seen on 10040 — a claim-race, not a display bug.
  This track's Finding B touches adjacent code but does not fix that race; it stays with 10040.
- Any change to how `machine_token` is derived or stored. REQ-2 works around it by excluding
  live tracks; re-identifying workers per process is a larger change belonging with 10045.
