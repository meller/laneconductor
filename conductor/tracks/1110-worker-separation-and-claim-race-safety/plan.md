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

## Phase 2: Problem A — flock-based single-instance guard

**Problem**: `getRunningWorkerPid()` trusts a pidfile that can be stale.
**Solution**: Acquire an OS-level advisory lock (`flock(2)` via a small
wrapper, or the `proper-lockfile` npm package if a dependency is
acceptable — decide based on what's already in `package.json`) on a lock
file per identity (`conductor/.worker-<N>.lock` for project workers,
`~/.laneconductor/manager.lock` for the manager), held for the entire
process lifetime. `lc worker start` attempts a non-blocking acquire;
failure means "already running" regardless of pidfile state. The OS
releases the lock automatically if the holding process dies by any
means, including `SIGKILL` — this is what makes it strictly better than
the pidfile check for REQ-2.

- [ ] Task 1: Small lock helper in `bin/lc.mjs` (or a new
      `conductor/services/worker-lock.mjs` if it needs to be shared with
      the sync script) — `acquireLock(path): boolean`, non-blocking
- [ ] Task 2: Wire into `lc worker start`'s existing guard alongside (not
      necessarily replacing outright — keep the pidfile for
      status/logs/stop, but make the lock the source of truth for
      "already running")
- [ ] Task 3: Wire the same lock into `lc worker start --manager`
- [ ] Task 4: Test — two rapid `lc worker start` invocations for the same
      identity → exactly one live process; `SIGKILL` the holder → an
      immediate subsequent `lc worker start` succeeds (REQ-1, REQ-2)

**Impact**: A stale/missing pidfile can no longer cause a duplicate
worker process.

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
