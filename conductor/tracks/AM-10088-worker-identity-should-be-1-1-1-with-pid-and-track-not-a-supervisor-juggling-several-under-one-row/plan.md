# Track AM-10088: Worker identity should be 1:1:1 with pid and track

## Phase 0: Validate the allocation scheme against real concurrency (spike, no shipped behavior change)

**Problem**: spec.md's Data Model Changes section leaves option 1 (derived `worker_number` per
concurrent claim, reusing the existing `(hostname, project_id, worker_number)` upsert key) vs.
option 2 (a new table/column) open, pending a race-safety check.
**Solution**: work out, on paper against the real spawn/exit code
(`conductor/laneconductor.sync.mjs` around lines 6027-6154), exactly when a derived
`worker_number` would be allocated and released, and whether two claims racing to allocate
concurrently (e.g. `parallel_limit: 3`, all three slots claimed within the same event-loop tick
of `autoLaunchLocalFs`) can collide on the same derived number before either's row is written.

- [ ] Trace `autoLaunchLocalFs`'s claim loop (`runningPids.size >= globalLimit` gate) to confirm
      claims within one pass are sequential (single-threaded Node event loop) — if so, a simple
      in-memory pool (e.g. `usedClaimSlots = new Set()`, allocate lowest free integer above the
      base `workerNumber`, release on exit) is race-free by construction and option 1 is safe.
- [ ] If claims can ever be initiated from more than one place concurrently (check whether
      manual dispatch / `worker_dispatch` claims share the same `runningPids` bookkeeping or a
      separate path), confirm the pool is still single-writer, or fall back to option 2.
- [ ] Decide and document the winning option before Phase 1 writes any code.

**Impact**: no shipped behavior change — this phase is a design decision, recorded in this
file, not code.

## Phase 1: Claim-scoped worker registration on spawn

**Problem**: every concurrent claim calls the same process-wide `updateWorkerHeartbeat('busy',
...)` (line 6034), so only the last-written claim's task survives in the `workers` row.
**Solution**: at the exact point a concurrent claim is spawned (same call site as the existing
`runningPids.add(proc.pid)` / `runningLaneMap.set(proc.pid, laneStatus)` /
`runningTrackMap.set(proc.pid, trackNumber)` triplet, lines 6117-6119), also register/heartbeat
a claim-scoped worker identity carrying THIS claim's own `pid`, `status: 'busy'`, and
`current_task` — using whichever allocation scheme Phase 0 validated. The very first/only
concurrent claim continues using the process's existing base `workerNumber` row exactly as
today (REQ-4) — this phase only adds rows for the SECOND and later concurrent claims.

- [ ] Write a lightweight claim-scoped heartbeat call (sibling to `updateWorkerHeartbeat`, not
      the heavier `upsertWorker`) that upserts using the allocated claim identity.
- [ ] Wire it into the spawn call site alongside the existing `runningPids`/`runningLaneMap`/
      `runningTrackMap` bookkeeping — same place, same data already in scope, no new tracking
      invented.
- [ ] Confirm the base `workerNumber`'s own row is not double-reported once a second claim
      exists (i.e. its `current_task` should reflect ITS OWN claim, not get overwritten by the
      second claim the way it does today).

**Impact**: a second (or Nth) concurrent claim now gets its own row instead of clobbering the
first's.

## Phase 2: Retirement on exit

**Problem**: a claim-scoped row must disappear (or go idle) exactly when its owning process
exits — never lingering, never affecting a sibling claim's own row.
**Solution**: in the existing `proc.on('exit', ...)` handler (line 6148 onward, right where
`runningPids.delete(proc.pid)` / `runningLaneMap.delete(proc.pid)` already happen), also retire
(or idle) this claim's own worker row and release its allocated slot back to Phase 0/1's pool.

- [ ] Add the retirement call at the exit handler, symmetric with Phase 1's registration.
- [ ] Verify a second claim's exit does not touch the first claim's still-running row (test
      this directly — see test.md TC-2).

**Impact**: Workers panel accurately drops a row the instant its claim actually finishes,
matching the row that appeared when it started.

## Phase 3: Orphan detection for claim-scoped rows

**Problem**: if the owning process is killed hard enough that the exit handler never runs (a
SIGKILL, an OOM kill), Phase 2's retirement never fires and the claim-scoped row would sit
forever falsely `busy` on a dead pid.
**Solution**: extend whichever existing worker-orphan-detection mechanism already exists for
regular workers (grep the codebase for the existing pattern — this project has prior orphan-pid
incidents and reconciliation logic already, e.g. run-marker-based liveness checks used
elsewhere in this same file) to also sweep claim-scoped rows, checking pid liveness the same
way.

- [ ] Identify and reuse the existing worker/orphan liveness-check primitive rather than writing
      a second one.
- [ ] Confirm a killed (not gracefully exited) concurrent claim's row is reconciled within one
      of that mechanism's normal sweep cycles.

**Impact**: closes the crash case spec.md's REQ-6 requires — no permanently-stuck-`busy` ghost
rows.

## Phase 4: Verify the Workers UI end-to-end, no UI code changes expected

**Problem**: confirm the existing Workers panel (`ui/src/components/WorkersList.jsx`), which
already renders one card per `workers` row, correctly displays N concurrent claims once N rows
genuinely exist — this phase is verification, not new UI work, unless something surprising
turns up.
**Solution**: drive a real `parallel_limit >= 2` lane with two genuinely concurrent claims
(matching the live livingwork reproduction in spec.md) and confirm both show up correctly,
distinctly, with correct current_task per row.

- [ ] Live end-to-end verification against a real two-concurrent-claim scenario (not mocked) —
      screenshot or transcript both rows showing correctly.
- [ ] Confirm the single-claim case (REQ-4) is visibly unchanged — same worker card, same
      worker_number, before and after this track's changes.
- [ ] If the UI needs any change at all (e.g. grouping claim-scoped rows visually under their
      parent process), scope and implement it here — but expect this phase to be pure
      verification, since the UI already renders one card per row with no assumption baked in
      that a project has only one worker row.
