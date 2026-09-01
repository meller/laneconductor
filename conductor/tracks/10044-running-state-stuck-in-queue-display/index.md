# Track AM-10044: Board Shows queue While Lane Action Is Actively Running

**Lane**: implement
**Merge Mode**: direct
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: New
**Type**: dev
**Track Kind**: bug
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Planned. Root cause pinned: two startup resets clear `running` with no liveness check (filesystem `resetFilesystemRunningStatus`, and the `immediate` DB reset scoped by a machine_token that…

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

## Root Cause (pinned at planning — full evidence in spec.md)

Not the claim-write direction. Three defects sharing one shape: something clears `running`
without checking whether a run is alive, and nothing can put it back.

- **A** — `resetFilesystemRunningStatus()` (`sync.mjs:2864`) wipes `running` → `queue` in
  every `index.md` at worker startup, with no liveness check. Track 10020's
  `conductor/.runs/<track>.json` markers already answer "is that PID alive?" cross-process;
  this function doesn't consult them.
- **B** — the `immediate:true` DB reset (`ui/server/index.mjs:3248`) is scoped by
  `machine_token`, which identifies a worker *row*, not a *process* (`sync.mjs:986`) — so
  duplicate processes of one worker reset each other's live claims. Track 1117 Bug 1 fixed
  cross-worker stomping; same-identity stomping survived it.
- **C** — `POST /tracks/heartbeat` gates its UPDATE on `lane_action_status='running'`, so the
  worker's 5s heartbeat can refresh a timestamp but never restore a wrongly-cleared status.

The fresh-`last_heartbeat`-with-`queue` paradox is explained, not a fourth bug: `POST /track`
sets `last_heartbeat = NOW()` in the same upsert that writes the stale `queue` from the file.

## Solution

Liveness-gate both resets against the existing run markers (A, B), and make the 5s heartbeat
repair a `queue` row for any track in `runningTrackMap` (C) — narrowly, never against a
terminal status. Also fixes **D**: `startNextAutoCompleteStage` (`sync.mjs:6323`) never patches
the DB at all, the gap commit `0abfcf8` closed for `checkDispatchInbox`.

Relationship to [[AM-10045-e2e-tests-leak-real-worker-from-worktree]]: shared trigger,
independent fixes. The leaked workers made A and B fire dozens of times instead of once — but
both are bugs at a single deliberate restart too. 10045 stops the duplicates; this track makes
run-state correct even when duplicates exist. The ~90s duplicate-dispatch race stays with
10040 — adjacent code, different defect.

## Related Tracks

- [[AM-10039-cloud-workers-claude-cloud]] — incident context (dispatch 2848); its dispatcher
  modes will lean even harder on DB-truth for run state (REQ-6), making this bug worse there.
- [[AM-10040-manager-stuck-track-healing]] — the other half of the incident; also owns
  stuck/stale-state semantics that this bug's fix touches.

## Phases

- [ ] Phase 1: Reproduce all three defects as failing tests (red before any fix)
- [ ] Phase 2: Liveness-gated startup filesystem reset (Finding A)
- [ ] Phase 3: Process-safe immediate DB reset (Finding B)
- [ ] Phase 4: Self-healing heartbeat assert (Finding C)
- [ ] Phase 5: Auto-complete DB parity (Finding D)
- [ ] Phase 6: Real-product verification + full regression run
**Auto Run**: yes
