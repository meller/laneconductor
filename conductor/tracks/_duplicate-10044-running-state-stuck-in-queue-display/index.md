# Track AM-10044: Board Shows queue While Lane Action Is Actively Running

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Track Kind**: bug
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Live incident (2026-08-30, tracks 10039 + 10040 simultaneously): dispatched lane actions were actively running (live PIDs, fresh heartbeats, growing logs) while the Kanban board showed both tracks…

## Problem

During dispatch 2848 (track 10039) and an auto-run implement (track 10040), both runs were
live for 6+ minutes — processes alive, `last_heartbeat` fresh, logs growing — yet
`tracks.lane_action_status` stayed `queue` in the DB, so the board showed both cards as idle
in-queue. Observed state during the incident:

- Worktree copy of 10039's index.md: `**Lane Status**: queue` (correct — written by the
  run's claim step).
- Primary checkout's copy: `**Lane Status**: queue` (stale — last written by the dispatch
  queuing step; feeds the DB and therefore the UI).
- 10040 additionally logged a duplicate-dispatch race: two implement processes spawned ~90s
  apart; the second stood down with an ℹ️ comment noting the first "claimed the canonical
  folder (Lane: running, now uncommitted)" — yet the primary/DB still read `queue` minutes
  later.

Candidate root causes for planning to verify (not conclusions):
1. The dispatch/claim path writes `running` to the worktree copy of index.md instead of (or
   after) the canonical primary copy — the single-writer direction is inverted for the claim
   marker.
2. A DB→FS pull or the concurrent-edit grace period re-asserts the stale `queue` over the
   uncommitted `running` claim (a [SYNC] "concurrent_edit_grace_period SKIPPED" line was
   observed for 10039's index.md during the window).
3. The 5s track-heartbeat loop updates `last_heartbeat` but nothing corrects
   `lane_action_status` for a track present in `runningTrackMap` — the worker knows it's
   running and never tells the DB.

## Solution (to be refined at planning)

- Make the claim marker's write target the canonical primary index.md (or write DB-first for
  lane_action_status on claim), so the board flips to running the moment work starts.
- Consider the cheapest reliable fix: the existing 5s heartbeat POST for runningTrackMap
  entries could also assert `lane_action_status: running` server-side — the worker already
  knows the truth every 5 seconds.
- Regression test: dispatch a mock lane action; assert the DB row reads `running` within one
  heartbeat interval and reverts on completion.
- Related but distinct (note, don't scope-creep): the duplicate-dispatch race 10040 hit
  (~90s double spawn) — if planning finds it shares a root cause, widen; otherwise file
  separately.

## Related Tracks

- [[AM-10039-cloud-workers-claude-cloud]] — incident context (dispatch 2848); its dispatcher
  modes will lean even harder on DB-truth for run state (REQ-6), making this bug worse there.
- [[AM-10040-manager-stuck-track-healing]] — the other half of the incident; also owns
  stuck/stale-state semantics that this bug's fix touches.

## Phases

- [ ] Phase 1: Reproduce + pin the root cause (claim-write target vs sync race vs missing heartbeat assert)
- [ ] Phase 2: Fix + regression test (DB reads running within one heartbeat of claim)
