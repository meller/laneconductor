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

- [x] Trace `autoLaunchLocalFs`'s claim loop (`runningPids.size >= globalLimit` gate) to confirm
      claims within one pass are sequential (single-threaded Node event loop) — if so, a simple
      in-memory pool (e.g. `usedClaimSlots = new Set()`, allocate lowest free integer above the
      base `workerNumber`, release on exit) is race-free by construction and option 1 is safe.
- [x] If claims can ever be initiated from more than one place concurrently (check whether
      manual dispatch / `worker_dispatch` claims share the same `runningPids` bookkeeping or a
      separate path), confirm the pool is still single-writer, or fall back to option 2.
- [x] Decide and document the winning option before Phase 1 writes any code.

**Decision (option 1, confirmed race-free)**: `spawnCli` (laneconductor.sync.mjs) is the ONE
call site that ever adds to `runningPids`/`runningLaneMap`/`runningTrackMap` — auto-launch's
claim loop, manual `worker_dispatch`, and chat-triggered dispatch all funnel through this same
function, never a second path. The identity decision (`baseIdentityOwnerPid === null ? reuse
: allocate`) sits immediately after `spawn()` with no `await` in between, and JS's
single-threaded event loop guarantees no two `spawnCli` invocations interleave their synchronous
sections — so two claims "racing" within the same auto-launch pass are actually strictly
sequential at the point the identity is chosen. Implemented as `CLAIM_WORKER_NUMBER_BASE
(= workerNumber * 100000) + slot`, `slot` the lowest free integer from an in-memory `Set`
(`claimSlotsInUse`), allocated/released synchronously at spawn/exit. Derived numbers land far
outside any realistic manually-assigned `--worker-number`, so they can never collide with a real
worker's own `(hostname, project_id, worker_number)` row. Option 2 (new table/column) was not
needed.

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

- [x] Write a lightweight claim-scoped heartbeat call (sibling to `updateWorkerHeartbeat`, not
      the heavier `upsertWorker`) that upserts using the allocated claim identity.
      `registerClaimWorker`/`heartbeatClaimWorker` (POST `/worker/register` once, then PATCH
      `/worker/heartbeat` on the existing 10s cadence — see the `setInterval` at the top of the
      file) — a 404 on heartbeat (row missing, e.g. collector restarted) falls back to
      re-registering, mirroring the base identity's own 401 handling.
- [x] Wire it into the spawn call site alongside the existing `runningPids`/`runningLaneMap`/
      `runningTrackMap` bookkeeping — same place, same data already in scope, no new tracking
      invented.
- [x] Confirm the base `workerNumber`'s own row is not double-reported once a second claim
      exists (i.e. its `current_task` should reflect ITS OWN claim, not get overwritten by the
      second claim the way it does today). Verified via TC-3/TC-2 in
      `conductor/tests/track-am-10088-claim-scoped-workers.test.mjs`.

**Impact**: a second (or Nth) concurrent claim now gets its own row instead of clobbering the
first's.

## Phase 2: Retirement on exit

**Problem**: a claim-scoped row must disappear (or go idle) exactly when its owning process
exits — never lingering, never affecting a sibling claim's own row.
**Solution**: in the existing `proc.on('exit', ...)` handler (line 6148 onward, right where
`runningPids.delete(proc.pid)` / `runningLaneMap.delete(proc.pid)` already happen), also retire
(or idle) this claim's own worker row and release its allocated slot back to Phase 0/1's pool.

- [x] Add the retirement call at the exit handler, symmetric with Phase 1's registration.
- [x] Verify a second claim's exit does not touch the first claim's still-running row (test
      this directly — see test.md TC-2).

**Real bug found and fixed while verifying this phase**: `spawnCli`'s exit handler already had
a PRE-EXISTING, unconditional `updateWorkerHeartbeat('idle', null)` call (line ~6397) that fires
on EVERY spawned process's exit — including a claim-scoped process's exit. Since that call
always reports on the BASE identity's row (it uses the worker's own `pid`, not the exiting
child's), a claim-scoped claim finishing would incorrectly flip the BASE row to idle even while
a totally different, still-running sibling claim legitimately owns and is actively using that
base row. Found live via TC-5 (kill -9 the derived-identity claim, assert the base-identity
sibling stays `busy`) — it failed with `'idle' !== 'busy'` before the fix. Fixed by capturing
`wasBaseIdentityOwner = proc.pid === baseIdentityOwnerPid` before nulling it out, and gating the
idle heartbeat on that flag. This is exactly the class of bug REQ-5 exists to prevent.

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

- [x] Identify and reuse the existing worker/orphan liveness-check primitive rather than writing
      a second one. Found it: `GET /api/projects/:id/workers` (ui/server/index.mjs) already
      filters every row on `last_heartbeat > NOW() - INTERVAL '60 seconds'` — this is how the
      BASE identity row itself has always disappeared from the Workers panel when its owning
      process dies (nothing bespoke was ever built for that case either). A claim-scoped row
      lives in the exact same `workers` table, heartbeated on the exact same 10s cadence
      (wired in Phase 1's `setInterval` addition), so it inherits this same 60s staleness
      window automatically — if the WORKER PROCESS itself is killed hard enough that no exit
      handler for any of its children ever runs, every row it owns (base AND every claim-scoped
      one) simply stops being heartbeated together and ages out of every listing together, with
      zero additional code. This satisfies REQ-6 by reuse, not by writing a second mechanism —
      `reapOrphanedWorkerProcesses` (the OTHER orphan primitive in this file) was considered and
      rejected: it targets stray `laneconductor.sync.mjs` PROCESSES specifically
      (`parsePsWorkerRows` greps for that binary in `ps` output), and a claim-scoped row's `pid`
      is a spawned CLI CHILD, not a `laneconductor.sync.mjs` process — that mechanism would
      never match it anyway.
- [x] Confirm a killed (not gracefully exited) concurrent claim's row is reconciled within one
      of that mechanism's normal sweep cycles. TC-5 covers the child-killed-directly case (the
      exit handler DOES still fire for a SIGKILL'd direct child — Node's `exit` event fires
      regardless of signal, this is Phase 2's path, not a true orphan). The true orphan case
      (the WORKER PROCESS itself dying) is the passive 60s-staleness window above — not
      independently re-tested with a real worker-process kill in this track (would require
      killing the test's own worker process mid-run and re-querying the collector after >60s of
      real wall-clock time with no heartbeat, which the existing suite's assertions don't need
      to reproduce since it's the identical, already-trusted mechanism the base row already
      relies on for the same failure mode).

**A related gap found and fixed while verifying this phase**: Phase 2's `retireClaimWorker`
correctly reuses the existing `DELETE /worker` soft-de-registration path (marks the row
`offline`, backdates `last_heartbeat` by 10 minutes server-side) — but that path was built for
an actually-dead WORKER, and a claim-scoped row retiring is a routine, frequent, entirely
expected event (every concurrent claim finishing normally triggers it). Two existing UI
consumers of the shared `workers`/`workers/offline` data assume every row they see represents a
real worker/machine:
1. `GET /api/projects/:id/workers/offline` (the "recently offline, needs attention" alert strip
   in WorkersList.jsx) would have shown a scary red OFFLINE ghost for up to 24h after every
   single ordinary concurrent-claim completion.
2. TrackDetailPanel.jsx's "Run on worker" manual dispatch dropdown (and its `selectDefaultWorker`
   default-picking logic) would have listed/defaulted to claim-scoped rows as dispatch targets —
   nothing on that pid polls a dispatch inbox, so picking one would silently no-op.

Fixed by extracting `isClaimScopedWorker`/`CLAIM_WORKER_NUMBER_THRESHOLD` into the shared
`ui/src/lib/workerStatus.js` (previously duplicated ad hoc in WorkersList.jsx alone) and
filtering claim-scoped rows out of: `offlineOwnWorkers` in WorkersList.jsx,
`selectDefaultWorker`'s candidate pool, and TrackDetailPanel.jsx's `projectWorkers` state itself
(filtered once at the `setProjectWorkers` setter, so every fetch call site in that file is
covered without needing to remember to filter at each one individually).

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

- [x] Live end-to-end verification against a real two-concurrent-claim scenario — via
      `conductor/tests/track-am-10088-claim-scoped-workers.test.mjs`, using this project's own
      sanctioned E2E tier (real spawned `laneconductor.sync.mjs` worker process, real mock-cli
      child processes with real wall-clock delay, real mock-collector HTTP server standing in
      for the API — the same `node:test` + mock-collector pattern `local-fs-e2e.test.mjs` and
      `local-api-e2e.test.mjs` already use as this repo's "not mocked" E2E tier, per
      tech-stack.md's own Testing table). TC-2 confirms two real concurrent child processes each
      get their own row with correct, distinct pid/worker_number/current_task; TC-5 confirms a
      hard-killed claim's row is retired without touching its still-running sibling. **Not
      done**: a screenshot of the actual browser Kanban UI against two real `claude` CLI
      sessions running concurrently in THIS project's own live board — doing that would require
      either bumping this shared project's real `conductor/workflow.json` `implement` lane
      `parallel_limit` and creating throwaway tracks on the live, shared primary DB, or spinning
      up a fully separate demo project; judged out of proportion to this track's own verification
      budget given the sandboxed E2E test already exercises the identical real code paths
      (spawn, exit, heartbeat, retirement) a live `claude` session would. A component-level test
      (`WorkersList.test.jsx`, 3 new cases) confirms the actual React rendering: two rows render
      as two distinct cards each naming its own track, the base row keeps its Stop button, the
      claim-scoped row shows the "Claim" badge instead.
- [x] Confirm the single-claim case (REQ-4) is visibly unchanged — same worker card, same
      worker_number, before and after this track's changes. TC-3 (single claim, base
      worker_number) and `WorkersList.test.jsx`'s existing suite (unchanged, still 11/11 passing
      before my additions) both confirm this.
- [x] If the UI needs any change at all... — yes, two changes were needed (see Phase 3's "related
      gap" write-up above: the offline-alert strip and the dispatch dropdown/default-picker both
      needed claim-scoped rows filtered out). The base Workers panel rendering itself needed no
      change beyond the Claim badge/hidden-Stop-button (added in the uncommitted work this
      session resumed from) — it already rendered one card per row unconditionally.
