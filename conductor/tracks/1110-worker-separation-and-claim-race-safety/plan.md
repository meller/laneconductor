# Track 1110: Worker process separation + atomic track claiming

## Phase 1: Reproduction — prove the race before fixing anything

**Problem**: Both A and B are established by reading the code (the
worker's own comment admits B), not yet by an automated repro. Per
systematic-debugging, a fix without a reproduction that fails first isn't
trustworthy — and this repro doubles as the regression test the fix must
turn green.
**Solution**: Reuse `conductor/tests/local-fs-e2e.test.mjs`'s harness
(`setupProject`/`createTrack`/`startWorker`, `mock-cli.mjs`) — it already
spawns real `laneconductor.sync.mjs` processes against a throwaway
`conductor/tracks/` directory with no DB required, which is exactly what
problem B needs and is the fastest path to a deterministic repro. Problem
A (pidfile guard) is scoped to a separate, `bin/lc.mjs`-level test in
Phase 2 rather than this harness, since it's about `lc worker start`'s
own guard logic, not the sync script's internals.

- [ ] Task 1: New test file `conductor/tests/track-1110-claim-race.test.mjs`
      using the `local-fs-e2e.test.mjs` harness pattern
- [ ] Task 2: `setupProject()` + one queued track; start TWO worker
      processes against the same directory with `MOCK_CLI_DELAY_MS` long
      enough (~3000ms, longer than the 5000ms auto-launch tick minus
      startup jitter isn't required — just long enough that both workers'
      first tick can land before either mock CLI exits and the track
      moves lanes) that a double-claim, if it happens, is observable
      before either run completes
- [ ] Task 3: Observable signal for "how many times was this track
      claimed" — instrument via a shared marker file
      (`open(claimMarkerPath, 'a')` appending `${pid}\n`, read by
      `mock-cli.mjs` when invoked, gated behind a new
      `MOCK_CLI_CLAIM_MARKER` env var so this doesn't change default mock
      behavior) rather than parsing captured stdout, which is fragile
      across two interleaved child processes
- [ ] Task 4: Run several times (the race is timing-dependent — a single
      pass proving nothing isn't good enough evidence either way);
      confirm the marker file shows >1 distinct pid for the same track
      number in at least some runs, establishing the race is real and
      not merely theoretical
- [ ] Task 5: Document the observed reproduction rate (e.g. "double-claim
      observed in N/10 runs") in this file's Phase 1 notes once run —
      this number also tells us how aggressive the fix's own test
      threshold needs to be to avoid flaking in the other direction

**Observed 2026-08-13** (Task 5): double-claim reproduced in 4/8 and 2/8
across two independent 8-run passes — non-zero and repeatable, confirming
this is a genuine timing race rather than a one-off fluke. Root cause
independently confirmed while building the repro: `spawnCli`'s
context-injection fallback overwrites the trailing argv slot (normally
`trackNumber`) with the injected prompt text for any CLI whose last arg
looks like a prompt, `mock-cli.mjs` included — worth knowing for whoever
extends this test to multiple simultaneous tracks later, since
`MOCK_CLI_CLAIM_MARKER` had to be scoped to "distinct pid" rather than
"distinct pid per track" for that reason (see the marker's own comment in
`mock-cli.mjs`). Phase 5's regression threshold: 0/8 clean, twice, is the
bar the fix must clear.

**Impact**: A failing (intermittently red, 2-4/8 runs) test that proves
the race exists, committed before any fix — the baseline Phase 2-4 must
turn reliably green (0/8, repeatedly).

## Phase 2: Problem A — stop must confirm death; flock as defense-in-depth

**Corrected root cause (2026-08-13, before implementing)**: tracing
`bin/lc.mjs`'s actual `stop` handler (not assumed — read directly) shows
`getRunningWorkerPid()`'s liveness+cmdline check is already solid; the
real bug is in `stop`, not `start`'s guard:

```js
process.kill(pid);                          // sends SIGTERM, returns immediately
if (existsSync(pidFile)) unlinkSync(pidFile);  // deletes pidfile RIGHT AWAY
console.log(`✅ Worker stopped (PID: ${pid})`); // reports success — process may still be alive
```

`process.kill()` only delivers the signal; it does not wait for the
process to exit. `laneconductor.sync.mjs`'s own `SIGTERM` handler
(`conductor/laneconductor.sync.mjs:4970`) is `async () => { await
removeWorker(); process.exit(0); }`, and `removeWorker()` makes a network
call (`DELETE /worker`) with a **10-second timeout**
(`conductor/laneconductor.sync.mjs:502`'s `del()`). So a worker can
legitimately take up to ~10s to actually exit after receiving SIGTERM —
during which `stop` has already lied that it's stopped and removed the
one piece of state (`lc start`'s guard) that would have prevented a
second process. This precisely matches the live incident: `make lc-stop
&& sleep 1 && make lc-start` — 1 second is far inside that ~10s window.
`restart`'s handler has the identical bug (`process.kill(pid)` then
immediate `unlinkSync`, no wait).

**Solution — two layers, not one:**
1. **Primary fix**: `stop` (and `restart`) must poll for actual death
   (`process.kill(pid, 0)` throwing `ESRCH`) after sending SIGTERM, up to
   a bounded timeout slightly longer than `removeWorker`'s 10s budget
   (e.g. 12s), before deleting the pidfile or reporting success. If the
   process still hasn't exited by the deadline, escalate to `SIGKILL`
   (uncatchable — bounds worst-case wait deterministically) and only then
   clean up.
2. **Defense-in-depth**: an OS-level advisory lock (`flock(2)` via a
   small wrapper, or `proper-lockfile` if a dependency is acceptable —
   none currently in `package.json`) held for the process's entire
   lifetime, checked non-blocking by `start`. This catches everything
   layer 1 doesn't: a worker killed by something other than `lc stop`
   (manual `kill -9`, OOM killer, a crash), where no pidfile-deletion
   race is even involved — the pidfile is just stale and nothing ever
   told `start` that. The OS releases an flock automatically on process
   death by any means, so this has no staleness-window problem the way
   pidfiles/lockfiles-with-mtime-checks do.

Both layers matter: layer 1 fixes the specific incident that was
observed; layer 2 is what makes REQ-2 ("must not depend on the pidfile
being accurate... a process that dies without cleanup") actually hold in
general, not just for the one path that was caught.

- [ ] Task 1: Reproduction test — a fake worker process with a
      deliberately slow (~2s) `SIGTERM` handler; confirm `lc stop`
      currently reports success and deletes the pidfile while the fake
      process is still alive (RED, proves the bug)
- [ ] Task 2: Fix `stop` to poll for real death (bounded, SIGKILL
      escalation on timeout) before declaring success
- [ ] Task 3: Apply the identical fix to `restart`'s kill-then-unlink step
- [ ] Task 4: Task 1's test passes post-fix (GREEN) — `lc stop` now
      blocks until the fake process is actually gone
**Corrected design (2026-08-13, before implementing) — who actually
holds the lock**: `lc worker start` spawns `laneconductor.sync.mjs`
detached and exits almost immediately; it cannot itself hold a lock "for
the process's entire lifetime" because it doesn't live that long. Only
the long-running child (`laneconductor.sync.mjs`) persists, so it must be
the one to acquire and hold the lock, at its own startup, before doing
anything else. `lc worker start`'s role shrinks to: spawn the child, wait
a short grace period (~750ms), and check whether it's still alive — if
the child exited immediately (lock acquisition failed), surface that as
"already running"; if it's still alive, report success as today. Chosen
dependency: `proper-lockfile` (added to `package.json`) — not true
kernel-level auto-release, but atomic `mkdir`-based acquisition plus an
internally-managed mtime refresh while held, so a live process's lock
never goes stale, and a dead process's lock becomes stealable after a
bounded window (`stale` option) rather than staying wrong forever.

- [ ] Task 5: `conductor/services/worker-lock.mjs` —
      `acquireWorkerLock(path): Promise<release|null>` wrapping
      `proper-lockfile`, `stale` set generously above the heartbeat
      interval so a live, merely-slow-to-heartbeat worker is never
      mistaken for dead
- [ ] Task 6: Call it at the very top of `laneconductor.sync.mjs`'s
      startup (project identity: derived from `projectRoot` +
      `workerNumber`; manager identity: the existing
      `~/.laneconductor/manager-config.json` directory) — `process.exit(1)`
      with a clear message if acquisition fails, before any other startup
      work runs
- [ ] Task 7: `lc worker start` (project) and `--manager`: after spawning,
      wait the grace period and check child liveness; surface a clear
      "already running" message if it died immediately
- [ ] Task 8: Test — two rapid `lc worker start` invocations for the same
      identity → exactly one live process; `SIGKILL` the holder (bypassing
      `stop` entirely, unlike Task 1's test) → an immediate subsequent
      `lc worker start` still succeeds once the lock's `stale` window
      passes (REQ-1, REQ-2)

**Confirmed live again while writing this phase (2026-08-13)**: cleaning
up after the Task 1-4 fix landed, found the *exact* class of bug this
layer targets, unprompted — `lc stop` reported success in 31ms against a
pidfile that had already drifted to point at a phantom pid (597416, not
alive), while the real worker (pid 420522, hung and unresponsive, 9h13m
old) sat completely untouched and only discovered by manually diffing
`ps` against the pidfile. `stop` did exactly what Task 1-4 now correctly
guarantees — confirmed death of the pid *it was told about* — but that
pid was already wrong, which is precisely what a lock (checked by the
long-lived process itself, not read from a file another command trusts)
closes.

**Impact**: `lc stop`/`restart` can no longer report success while the
old process is still alive (the actual observed incident), and a stale
pidfile from any other cause can no longer fool `start` into spawning a
duplicate.

## Phase 3: Problem B, API mode — wire to the existing atomic endpoint

**Problem**: `autoLaunchLocalFs`'s API-mode branch decides from a raw
file read instead of the already-built atomic `claim-queue` endpoint.
**Solution**: Before spawning in the API-mode branch (where a DB
connection is known to exist), call `POST /tracks/claim-queue` for the
candidate track and only proceed to write `Lane Status: running` /
spawn if the claim response actually includes that track (i.e. this
process won the `FOR UPDATE SKIP LOCKED` race). If the DB says another
process already has it, skip — don't spawn, don't write. This turns
`autoLaunchLocalFs` from "decider" into "executor of what the DB already
granted" for API mode specifically, leaving local-fs mode's file-based
decision untouched (it has no DB to ask).

- [ ] Task 1: Call `claim-queue` (already implemented, already tested)
      from the API-mode auto-launch branch before the write/spawn step
- [ ] Task 2: Reconcile with the existing `claimableSet` (1109's
      allowlist gate) — claim-queue's own query needs the same
      visibility/ownership filtering `claimableSet` already applies, or
      the two mechanisms could disagree about which tracks are eligible
- [ ] Task 3: Confirm no behavior change for the single-worker case
      (REQ-5) — claim-queue should return the same track a single worker
      would have picked via today's file read, just atomically
- [ ] Task 4: Existing `track-1033-worker-auth.test.mjs` claim-queue
      tests still pass unmodified

**Impact**: Two worker processes in API mode can no longer double-claim
the same track — the DB row lock makes it impossible, not just unlikely.

**Verified 2026-08-13**: `conductor/tests/track-1110-claim-race-api-mode.test.mjs`
— two distinct, legitimately-running workers (worker_number 1 and 2)
racing on one queued track via a real mock collector, 5 repeated runs:
**0/5 double-spawns** post-fix. Confirmed the test is meaningful (not
trivially green) by temporarily swapping in the pre-Phase-3 version of
`laneconductor.sync.mjs` and re-running: **3/5 runs double-spawned**
against the old code, exactly the race Phase 1 predicted. Restored the
fix immediately after. Also confirmed unaffected: single-worker case
(REQ-5, own test) and the existing `track-1033-worker-auth.test.mjs`
suite (59/60 — the one failure is pre-existing and unrelated, confirmed
via `git stash` against fully reverted code) and `local-api-e2e.test.mjs`
(5/6, same pre-existing failure, not caused by this change).

Local-fs mode's own claim-race test
(`track-1110-claim-race.test.mjs`, Phase 1) still shows the race
post-Phase-3 (5/8 double-claims on the latest run) — expected and
correct: Phase 3 is API-mode only by design; Phase 4 is what closes the
local-fs case.

## Phase 4: Problem B, local-fs mode — atomic claim-file primitive

**Problem**: Local-fs mode has no DB to arbitrate a claim.
**Solution**: Before the read-decide-write sequence trusts a track as
claimable, attempt to atomically create a claim marker file for it via
`openSync(claimPath, 'wx')` — the `'wx'` flag fails with `EEXIST` if the
file already exists, which is atomic at the OS level (no read-then-write
gap). Only a process that successfully creates the marker may proceed to
write `Lane Status: running` and spawn. The marker is removed when the
run completes (success or failure) — `spawnCli`'s existing exit-handler
cleanup path is the natural place.

- [ ] Task 1: `claimTrackFile(tracksDir, trackNumber): boolean` — atomic
      create-if-absent via `'wx'`, returns whether *this* call created it
- [ ] Task 2: Call it in `autoLaunchLocalFs` immediately before the
      existing write/spawn step; skip the track (don't spawn) if the
      claim fails
- [ ] Task 3: Remove the marker in `spawnCli`'s exit handler (both
      success and failure paths — a stuck marker after a crash would
      permanently block that track, which is its own bug worth a
      startup sweep: clear markers for tracks not in `runningPids` on
      worker start, mirroring the existing "reset stale running status"
      startup logic)
- [ ] Task 4: This is what Phase 1's reproduction test exercises directly
      — turning that test green (reliably, across many runs) is this
      phase's actual completion signal, not a new test written after
      the fact

**Impact**: Local-fs and sync+poll modes (which share this code path)
can no longer double-claim, closing the general case Phase 3 only
addressed for API mode.

**Design correction made before finishing (2026-08-13)**: the plan's own
Task 3 wording ("clear markers for tracks not in runningPids on startup")
would have been a real bug if implemented literally — multiple
legitimate workers (worker_number 1, 2, ...) share this same
`conductor/tracks/` directory (track 1084 Phase 0), so "I own no PIDs
yet" says nothing about whether ANOTHER, currently-live sibling worker
claimed a track moments before this one started. A blind per-process
sweep would delete a live sibling's claim out from under it —
reintroducing the exact race this phase exists to close, just moved to
worker-startup timing. Used mtime-based staleness instead
(`spawn_timeout_ms` + 30s margin), mirroring `checkAndClaimGitLock`'s
already-established pattern in this same file for the identical
"survive concurrent legitimate holders, still recover from a dead one"
problem.

**Verified 2026-08-13**: Phase 1's original reproduction test
(`track-1110-claim-race.test.mjs`) — red for this entire track's
duration (2-5/8 double-claims across every prior run) — is now GREEN,
twice in a row (0/8, 0/8). Full regression sweep (13 test files touching
worker startup/spawn/claim): 33 tests passing, only the same
pre-existing, already-confirmed-unrelated `local-api-e2e.test.mjs`
failure remains.

Also found and fixed two Phase 2 regressions that Phase 2's OWN
regression pass had missed (not caused by Phase 4's changes, surfaced
while running Phase 4's broader sweep): `track-1091-manager-worker.test.mjs`
and `track-1091-create-project-worker.test.mjs` both spawn their own
"test" manager worker without `LC_SKIP_WORKER_LOCK` — harmless when no
real manager is running, but the manager identity lock is deliberately
machine-global (matching the real `workers_one_manager_per_host`
constraint), so it correctly refused a second one once a genuinely live
manager process happened to be running on this development machine
(pid 954975, from earlier dogfooding this session). Fixed by adding the
skip flag those tests' own isolation already needed — the lock was
working exactly as designed; the tests hadn't been updated for it.
`track-1089-provision-worker-dispatch.test.mjs`'s manager spawn was
unaffected — it already isolates via a fake `HOME`, which the lock path
(derived from `os.homedir()`) naturally respects.

## Phase 5: Full regression pass

**Problem**: Both fixes touch code every project's worker runs through.
**Solution**: Run the full existing suite, not just this track's new
tests — this is core-path change, the highest-leverage place a silent
regression could hide.

- [ ] Task 1: `local-fs-e2e.test.mjs` full suite green
- [ ] Task 2: `track-1091-*`, `track-1084-*`, `track-1033-worker-auth.test.mjs` green
- [ ] Task 3: Phase 1's reproduction test green across a repeated-run
      threshold matching what Phase 1's Task 5 established as the
      original failure rate (e.g. 10/10 clean if the bug reproduced in
      most runs pre-fix)
- [ ] Task 4: Manual live check — restart this project's own worker
      (dogfooding) and confirm no duplicate-process/duplicate-claim
      symptom recurs, mirroring how the original bug was found
