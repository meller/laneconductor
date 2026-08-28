# Track 10020: Bug fixes round 2

**Lane**: review
**Lane Status**: queue
**Track Kind**: bug
**Merge Mode**: direct
**Auto Run**: yes
**Progress**: 100%
**Last Run**: implement (primary) — Phases 2-4 implemented and verified
**Summary**: Orphaned dispatches are only reconciled once at worker startup, so a dispatch orphaned mid-run stays frozen forever; make reconciliation periodic and add a cross-process CLI-liveness signal.

## Problem
Follow-up sync-worker/dispatch reliability bugs found while dogfooding track 10018's merge (2026-08-20).

1. reconcileOrphanedDispatches() (conductor/services/orphaned-dispatch.mjs, wired via conductor/laneconductor.sync.mjs:1034) only runs ONCE per sync-worker process, gated by hasReconciledOrphanedDispatches, right after that worker registers at startup. If a worker restarts WHILE a dispatched lane action is still genuinely running (worktree index.md still says Lane Status: running), the one-time check correctly finds nothing to reconcile and never runs again for that process. If the CLI process then finishes minutes later, nothing is left to notice: spawnCli's own proc.on(exit) handler lived in the memory of the now-replaced worker process, so it never fires either. The dispatch, the DB lane_action_status, and primary's index.md all stay frozen at their pre-run values indefinitely, even though the worktree's own index.md correctly shows the finished done/success state and is fully committed.

   Reproduced live: track 10018's quality-gate dispatch (worker_dispatch id 1588, worker_id 998) finished successfully (worktree index.md: Lane: done, Lane Status: success, committed) but sat stuck at quality-gate:queue in DB/primary for 5+ minutes with zero live process tracking it, because worker 998's process had been replaced sometime between claiming the dispatch and the CLI actually exiting.

   Fix direction: make reconcileOrphanedDispatches() (or an equivalent check) run periodically (e.g. alongside the existing 5s reconcileActiveDispatch tick) instead of only once at startup, so it can catch a dispatch that becomes orphaned mid-run, not just ones already orphaned when a worker boots.

2. (Already fixed directly on main, included here for reference/context only — no further action needed) checkDispatchInbox()'s lane-action dispatch branch wrote Lane Status: running to the track's local index.md when spawning a dispatched CLI, but never PATCHed the DB's lane_action_status to match (only the failure path patched DB, reverting it). Result: the UI showed a dispatched track as queued for its entire run. Fixed in commit 0abfcf8 by adding the missing PATCH /track/:num/action lane_action_status=running call, mirroring the failure branch and how claimQueuedTracks() already does this for the other auto-launch path.

## Solution
Give orphan reconciliation a **periodic tick** (not just a one-shot at worker startup) plus a
**cross-process liveness signal** — a persistent per-track run marker holding the spawned CLI's
pid — so a dispatch that becomes orphaned *mid-run* is closed out within one tick, while a
still-genuinely-running orphan is never finalized early.

## Phases
- [x] Phase 1: Persistent run marker (`conductor/.runs/<track>.json`) written by spawnCli, removed on exit
- [x] Phase 2: Periodic `reconcileOrphanedDispatches()` tick with liveness/grace guards
- [x] Phase 3: Crashed-run detection (pid dead while Lane Status still `running`)
- [x] Phase 4: E2E regression tests (worker-restart orphan; bug 2 dispatch→DB `running`)
- [x] Phase 5: Docs + code comments for the new markers and env overrides
