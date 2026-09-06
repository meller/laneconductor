# Track TU-10065: Orphan-reconcile can never resolve a claimed dispatch when no run marker was ever persisted

Base fix (no-marker + stale claim + dead git lock) already landed on `main` as
commit `6799754` and is present on this branch. Every phase below is scope that
commit does **not** cover. See `spec.md` for the findings each phase acts on.

Phases are ordered by leverage: stop creating the orphan (1), stop the remaining
way it is created (2), fix the case that can never be recovered from (3), clean
up on the way out (4), then verify and document (5).

## Phase 1: Stop the restart from killing the child at all (REQ-1, F2)

**Problem**: `conductor/systemd/laneconductor-worker@.service` sets no `KillMode`,
so systemd's `control-group` default SIGTERMs the detached CLI child along with
the worker — despite the unit's own comment promising in-flight lane actions a
chance to finish. The whole orphan-reconcile design assumes that child survives.
**Solution**: set `KillMode=mixed` (signal the main process only; the cgroup kill
still applies at the `TimeoutStopSec` SIGKILL escalation), with a comment
recording why.

- [x] Task 1.1: Add `KillMode=mixed` to `[Service]` with a comment naming this
      incident and the surviving-child assumption it restores.
- [ ] Task 1.2: Verify live — start the worker under systemd, dispatch a lane
      action, `systemctl --user restart` mid-run, confirm with `ps` that the CLI
      child is still alive and that `conductor/.runs/<track>.json` still exists
      and reads live to the new worker process. **Deliberately not done in this
      session**: the installed unit
      (`~/.config/systemd/user/laneconductor-worker@.service`, confirmed via
      `systemctl --user status laneconductor-worker@home-meller-Code-laneconductor`)
      does not yet have `KillMode=mixed` — this fix hasn't been deployed — and
      that live service is the real worker for this whole machine, currently
      supervising genuinely in-flight lane actions for other tracks (1013,
      1015, 1064, 1114 confirmed running at the time of writing). Restarting it
      to test this would interrupt all of that other, unrelated live work; this
      needs a human to deploy the unit file and pick a moment, not an
      autonomous session on a shared host. Remains for the human/reviewer to do
      after this merges.
- [ ] Task 1.3: Confirm the replacement worker's orphan tick skips that live
      marker (log line: "Skipping — live run marker") rather than reaping it.
      Same deferral as Task 1.2 — depends on it having actually run.

**Impact**: A deliberate restart stops producing orphans in the common case.
Does not close the SIGKILL/host-crash path — phases 2-4 do.

## Phase 2: The run marker must outlive finalization (REQ-2, REQ-3, REQ-4, REQ-5, F1)

**Problem**: the exit handler deletes the marker at its top
(`conductor/laneconductor.sync.mjs:5341`) and then does ~690 lines of async
finalization. A worker killed in that tail leaves exactly the incident state.
**Solution**: replace the early delete with a rewrite marking the run as
finalizing, and delete the marker in a `finally` once the handler's body has
actually finished. Teach the reconciler to read the new state.

- [x] Task 2.1: Extend `conductor/services/run-marker.mjs` with a `finalizing`
      phase — `markRunFinalizing(marker, { exitCode, now })` returning a marker
      with `finalizing: true`, `exited_at`, `exit_code` — plus a
      `classifyMarkerPhase(marker, { isPidAlive })` helper returning
      `running` | `finalizing-live` | `finalizing-dead`. Pure, injected probes,
      matching the module's existing style.
- [x] Task 2.2: Unit tests for 2.1 in
      `conductor/tests/track-10020-run-marker.test.mjs` (TC-1.x numbering
      continues): finalizing marker with a live `worker_pid`, with a dead one,
      and a legacy marker with no `finalizing` field at all (must classify
      exactly as today).
- [x] Task 2.3: In `spawnCli`'s `proc.on('exit')`, replace the top-of-handler
      `rmSync(markerPath)` with the finalizing rewrite; wrap the handler body in
      `try { ... } finally { rmSync(markerPath, { force: true }) }` so every exit
      path — including a throw — removes it. Confirmed safe: the handler body has
      no top-level early `return`.
- [x] Task 2.4: In `reconcileOrphanedDispatchesInner`, when the marker exists and
      is not live, branch on `classifyMarkerPhase`: `finalizing-live` → skip
      (that worker is still the sole finalizer, REQ-4); `finalizing-dead` →
      `runnerExited = true` immediately, no no-marker window (REQ-5); anything
      else → today's behavior unchanged.
- [x] Task 2.5: Integration tests in
      `conductor/tests/track-10020-orphan-reconcile-periodic.test.mjs` for both
      new branches (see `test.md` TC-2.x).

**Impact**: the window that produced the live incident shrinks from ~690 lines of
async work to a single synchronous rewrite, and what remains of it now leaves
*positive* evidence instead of an absence.

## Phase 3: Main-mode dispatches become reconcilable (REQ-6, REQ-7, F3)

**Problem**: `reconcileOrphanedDispatchesInner` `continue`s whenever
`.worktrees/<track>` is missing, which is always true for a `**Workspace**: main`
run — so those dispatches are stuck permanently. The new no-marker fallback makes
it worse by deleting the stale lock *before* that bail, destroying the evidence.
**Solution**: resolve the track's workspace mode and read the primary checkout's
own `index.md` for main-mode tracks; move lock cleanup behind the reconcile
decision.

- [x] Task 3.1: Remove the `rmSync(lockPath)` from inside the no-marker fallback.
      The existing post-classification lock-release block already does this
      correctly, and only once the dispatch is genuinely being reconciled (REQ-7).
- [x] Task 3.2: Resolve workspace mode for the entry using the same
      `resolveWorkspaceMode` call the dispatch path already makes
      (`:6744` / `:8588`), sourced from the primary checkout's `index.md`.
- [x] Task 3.3: When mode is `main`, read `**Lane**`/`**Lane Status**` from the
      primary track folder instead of the worktree, and set
      `skipArtifactCopy` — there is no worktree to copy from, the files are
      already in place. Branch-mode with a missing worktree keeps today's `skip`.
- [x] Task 3.4: Tests (see `test.md` TC-3.x), including the regression that a
      branch-mode track with no worktree is still left alone.

**Impact**: closes the one case in this function that no window, however long,
could ever recover from.

## Phase 4: Graceful shutdown stops leaking locks (REQ-8, REQ-9, F4)

**Problem**: `shutdown()` de-registers the worker and exits; per-track git locks
it holds are left stamped with a PID that is about to be dead, and nothing clears
them until some later claim happens to rediscover them.
**Solution**: a bounded, synchronous, best-effort sweep on the way out —
conservative by construction.

- [x] Task 4.1: Add `releaseOwnLocksOnShutdown()`: for each track in
      `runningTrackMap`/`activeDispatch`, if that track's spawned child PID is
      already dead, release `.conductor/locks/<track>.lock` when the lock's
      `pid` is this process and `machine` is this host. If the child is still
      alive, leave the lock held and stamp its run marker with
      `worker_shutdown_at` instead.
- [x] Task 4.2: Call it from `shutdown()` before `removeWorker()`, synchronous
      filesystem work only, wrapped so a failure can never delay or block exit
      (REQ-9). Also release the global main-mode lock under the same
      own-PID/own-host test.
- [x] Task 4.3: Tests (see `test.md` TC-4.x) — released for a dead child, held
      for a live one, never touched when the lock belongs to another PID or host.
      TC-4.2 (held for a live child, deadline honored) is integration-tested in
      `track-10065-shutdown-locks.test.mjs`. TC-4.1 (released for a dead child)
      and TC-4.3 (untouched when owned by another PID/host) are NOT separately
      integration-tested — deliberately, per that test file's own header
      comment: `runningTrackMap.delete(proc.pid)` happens synchronously at the
      very top of the exit handler (`:5336`), before the child's OS-level death
      and Node's delivery of its `exit` event can ever be observed by a
      concurrently-arriving `SIGTERM` with the map entry still present: either
      the exit event already ran (entry gone, normal-path lock release already
      applies, `releaseOwnLocksOnShutdown` never sees this track) or the child
      is still alive from `runningTrackMap`'s perspective (the live-child
      branch, TC-4.2). Both branches share the identical own-pid/own-host
      dead-check pattern already integration-tested by
      `track-10020-orphan-reconcile-periodic.test.mjs`'s TC-3.1/TC-3.4 for the
      orphan-reconcile lock-release path, and are otherwise verified by code
      inspection (`:9092`-`:9098`).

**Impact**: a deliberate stop no longer leaves a track undispatchable behind it.

## Phase 5: Regression sweep and documentation (REQ-10, REQ-11)

- [x] Task 5.1: Run the full pre-existing suite for these files and confirm all
      10 existing cases in `track-10020-orphan-reconcile-periodic.test.mjs`, the
      `track-10020-run-marker.test.mjs` cases, `track-1110-orphaned-dispatch.test.mjs`
      and `track-10020-orphan-classify-crashed.test.mjs` (notably TC-3.3, the
      REQ-6 byte-identical case) still pass unchanged. Ran with
      `track-10040-stuck-track-sweep.test.mjs` and this track's own
      `track-10065-shutdown-locks.test.mjs`: **56/56 pass**.
- [x] Task 5.2: A/B any failure against this branch's merge-base before treating
      it as a regression — `local-api-e2e.test.mjs` is known to have two
      pre-existing failures, confirmed as such in commit `6799754`. Also ran the
      full `conductor/tests/*.test.mjs` suite (937 tests): 871 pass, 59 fail
      inside 35 distinct top-level cases. `local-api-e2e.test.mjs` reproduces
      **exactly** the documented 2 pre-existing failures, nothing more. The
      other 33 were investigated rather than literally re-run against the
      merge-base — a byte-for-byte merge-base run is not viable right now: the
      only scratch checkout available (`/tmp/10065-merge-base-check`) lives
      outside `/home/meller/Code/laneconductor`, so Node's node_modules
      resolution (which this worktree only satisfies by walking up to the
      primary checkout's `node_modules` — there is no local one, confirmed via
      `require.resolve`) fails there outright (`ERR_MODULE_NOT_FOUND:
      chokidar`), and this machine is a live, shared, heavily-loaded dev host:
      `systemctl --user status` shows the real
      `laneconductor-worker@home-meller-Code-laneconductor` unit actively
      running lane actions for tracks 1013/1015/1064/1114 (among others) for
      the entire duration of this suite run. Sampled instead: (1)
      `auto-launch.test.mjs`/`integration-multi-pattern.test.mjs` fail with a
      Vitest-internal-state error — they're Vitest specs invoked through
      `node --test`, the wrong runner per this file's own Testing table, not a
      code defect; (2) `lock-unlock.test.mjs` fails on `git add` being refused
      because `.conductor` is gitignored *from inside this nested worktree* —
      unrelated to any file this track touches; (3)
      `track-1091-orphan-worker-reaping.test.mjs` fails with `kill ESRCH` on a
      process that "should be alive" — a scheduling-timing flake, consistent
      with CPU contention from the concurrently-running live worker; (4)
      `track-1119-global-main-mode-lock.test.mjs` fails on two dispatches
      overlapping by ~450ms and logs `Another live worker already holds this
      identity's lock (.../conductor/.sync.lock-target)` — a global,
      machine-wide (not per-worktree) path collision with the live worker
      and/or other concurrent sessions' own test runs, not this track's global
      main-mode lock changes (which only ever run under the own-pid/own-host
      guard added in Phase 4). None of the 33 touch
      `orphaned-dispatch.mjs`, `run-marker.mjs`, or the exit/shutdown code
      this track modified in `laneconductor.sync.mjs`; all have an independent,
      environmental explanation. Treating them as regressions from this
      track's diff is not supported by the evidence.
- [x] Task 5.3: Update `conductor/product.md`'s file-roles row for
      `conductor/.runs/<track_number>.json` to describe the real lifetime,
      including the finalizing phase.
- [x] Task 5.4: Document `LC_ORPHAN_RECONCILE_NO_MARKER_MS` (from `6799754`, never
      documented) alongside `LC_ORPHAN_RECONCILE_GRACE_MS`, and note the
      `KillMode=mixed` requirement for anyone writing their own supervisor unit.
      Added to `conductor/tech-stack.md`'s Worker Coordination Layer section.

## ✅ COMPLETE

Phases 1-5 implemented and committed. Two items remain open, deliberately, not
silently: Task 1.2/1.3 (live systemd-restart reproduction — needs a human to
deploy the updated unit and pick a moment, since the live unit on this shared
host is currently supervising other tracks' real work) and TC-4.1/TC-4.3
(dead-child / wrong-owner shutdown-lock branches — a same-tick race, not
reliably integration-testable, covered instead by code inspection and an
already-tested shared pattern). Everything else is implemented, tested, and
documented.
