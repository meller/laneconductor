# Spec: Orphan-reconcile can never resolve a claimed dispatch when no run marker was ever persisted

## Problem Statement

A worker restart that takes its in-flight lane action down with it can leave a
`worker_dispatch` row stuck at `claimed` with **no path to resolution at all** —
not a slow one, a permanently absent one. The board keeps showing a live-looking
`running` card for a track nothing is working on, the per-track git lock stays
stamped with a dead PID, and the track can never be re-dispatched.

Confirmed live 2026-09-04 (track 10063, dispatch id 3428, worker_id 1112): a
`systemctl restart` for an unrelated systemd migration killed the worker's own
implement session mid-flight. Afterwards the worktree's `index.md` still read
`**Lane Status**: running`, `conductor/.runs/10063.json` did not exist, `ps`
confirmed the CLI was dead, and `.conductor/locks/10063.lock` still held the old
worker daemon's PID. This is **not** track 10054's worker-identity case: the same
worker id re-registered with a new PID and a fresh heartbeat, so the
offline-workers reconciliation path never applies. Resolved by hand.

## What Already Landed (do not redo)

Commit `6799754` (on `main`, so present on this branch) closed the base gap:
when no run marker exists **and** `worker_dispatch.claimed_at` is older than a
new, deliberately longer window (`LC_ORPHAN_RECONCILE_NO_MARKER_MS`, default
180000ms), `reconcileOrphanedDispatchesInner` falls back to the per-track git
lock — written synchronously by `checkAndClaimGitLock()` *before* the spawn that
would later write the marker, so it is independent evidence from the same claim.
A dead or absent lock PID is then treated the same as a marker proven dead
(`runnerExited: true`). Two tests cover it in
`conductor/tests/track-10020-orphan-reconcile-periodic.test.mjs` (10/10 passing).

This track's remaining scope is everything that fix does **not** cover, plus the
defects found while reading the code around it.

## Findings

- **F1 — The likely true root cause is marker deletion, not marker absence.**
  The track's "write the marker earlier" option cannot help: `spawnCli` already
  writes the marker synchronously in the same block as `spawn()`
  (`conductor/laneconductor.sync.mjs:5309`). But the exit handler *deletes* it at
  its very top (`:5341`), before roughly 690 lines of async finalization — retry
  counts, the action PATCH, artifact copy, git-lock release (`:5985`), dispatch
  finalization. A worker killed anywhere in that tail (exactly what a cgroup-wide
  restart does) leaves precisely the observed state: no marker, dead child, stale
  lock, dispatch `claimed`. The fix is to delete the marker *later*, not write it
  earlier.

- **F2 — The systemd unit kills the child it says it is protecting.**
  `conductor/systemd/laneconductor-worker@.service` sets `KillSignal=SIGTERM` and
  `TimeoutStopSec=30` under a comment reading "give in-flight lane actions a
  chance to finish", but sets no `KillMode`, so systemd's default
  (`control-group`) signals every process in the cgroup — including the detached,
  `unref()`'d CLI child the entire orphan-reconcile design assumes will *survive*
  a worker restart. This is the proximate cause of the 10063 incident.

- **F3 — A main-mode dispatch can never be reconciled at all.**
  `reconcileOrphanedDispatchesInner` skips any entry whose `.worktrees/<track>`
  directory is absent, and a `**Workspace**: main` run never creates one — while
  still taking the per-track git lock, so it *is* subject to the new no-marker
  fallback. The fallback therefore deletes the stale lock and then bails at the
  worktree check without ever finalizing the dispatch, destroying the evidence the
  next cycle would have used. The dispatch stays `claimed` forever, now with no
  lock either. Independent of the marker question entirely.

- **F4 — Graceful shutdown does nothing about in-flight work.** `shutdown()`
  (`:8955`) de-registers the worker within a 2s deadline and exits. It never
  stamps run markers, never releases the per-track git locks this worker itself
  holds, and never touches its own claimed dispatches.

- **F5 (noted, out of scope)** — `conductor/services/stuck-track-sweep.mjs` has no
  caller anywhere in the worker; it is exercised only by its own unit tests. Its
  `dbClaims` guard would have skipped this incident regardless. Wiring it belongs
  to track 10040, not here, and is deliberately **not** an acceptance criterion
  below.

## Requirements

- **REQ-1**: The systemd unit must leave detached lane-action children running
  when the worker itself is stopped or restarted, matching what the reconcile
  design already assumes.
- **REQ-2**: A run marker must survive the exit handler's entire finalization
  tail. It is removed only once finalization has actually completed, on every
  path (success, failure, throw).
- **REQ-3**: While finalizing, the marker records that state and the owning
  worker's PID, so a *different* process can distinguish "finalizing right now"
  from "died mid-finalization".
- **REQ-4**: A finalizing marker whose owning worker PID is **alive** must never
  be reconciled — that worker is the sole finalizer, exactly as
  `reconcileActiveDispatch()` is for in-process dispatches.
- **REQ-5**: A finalizing marker whose owning worker PID is **dead** is
  reconcilable immediately, without waiting out the no-marker window: this is
  positive evidence, strictly stronger than an absent marker.
- **REQ-6**: A dispatch whose track resolves to workspace mode `main` is
  reconciled from the **primary checkout's** own `index.md`, since that is where
  a main-mode agent writes its markers. Branch-mode tracks with a missing
  worktree keep today's behavior (skip).
- **REQ-7**: The no-marker fallback must not delete the per-track git lock before
  a reconcile decision is actually reached. Lock release stays where it already
  is — after classification says the dispatch is orphaned.
- **REQ-8**: On `SIGTERM`/`SIGINT`, the worker best-effort releases the per-track
  git locks it holds **only** for tracks whose spawned child is already dead, and
  stamps the markers of children that are still alive. A lock for a live child is
  deliberately left held — releasing it would let another worker claim a track
  that is still genuinely being worked on.
- **REQ-9**: All of the above is bounded by the existing `SHUTDOWN_DEADLINE_MS`
  and uses synchronous filesystem work only — no network calls on the shutdown
  path.
- **REQ-10**: Track 10020's REQ-6 still holds: with no marker and no other
  evidence, inside the grace windows, `runnerExited` stays `undefined` and
  `classifyOrphanedDispatch` behaves byte-identically to today.
- **REQ-11**: Documentation reflects the marker's real lifetime and the two new
  environment variables/behaviors.

## Acceptance Criteria

- [ ] A worker restarted mid-implement (`systemctl restart`) leaves its CLI child
      running; the track finishes and is reconciled normally instead of becoming
      an orphan in the first place. **Code done (`KillMode=mixed`,
      `systemd-analyze verify` clean), live reproduction deferred** — see
      `test.md` TC-1.2/TC-1.3 and `plan.md` Task 1.2: this machine's deployed
      unit doesn't have the fix yet and is the live worker for other
      concurrently-running tracks, so restarting it to test this now would
      disrupt unrelated real work. For a human to verify after deploying.
- [x] A worker killed *during* finalization leaves a track that returns to its
      queue on its own within one reconcile window, with the dispatch marked
      failed and a `⚠️` comment naming the action to re-run. (TC-2.6)
- [x] A main-mode track orphaned the same way also recovers, and its stale git
      lock is released. (TC-3.1)
- [x] A genuinely running lane action is never reaped: not while its child is
      alive, and not while another live worker is still finalizing it. (TC-2.3,
      TC-2.5)
- [x] Stopping the worker cleanly leaves no lock held for a track that has no
      process behind it. Live-child case integration-tested (TC-4.2, by
      showing the inverse holds); the dead-child release branch itself is
      verified by code inspection and shared-pattern equivalence rather than a
      new integration test — see `test.md` TC-4.1 for why that specific case is
      a same-tick race, not a reliably reproducible scenario.
- [x] `conductor/tests/track-10020-orphan-reconcile-periodic.test.mjs` passes in
      full, including all pre-existing cases. (10/10)

## Non-Goals

- Rewriting `classifyOrphanedDispatch`'s existing semantics or the 10020
  runnerExited contract.
- Wiring `stuck-track-sweep.mjs` into the worker (F5 — track 10040).
- Any change to how dispatches are claimed or to `reconcileActiveDispatch()`.
