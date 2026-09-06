# Tests: Track 10065 — Orphan-reconcile can never resolve a claimed dispatch when no run marker was ever persisted

## Test Commands

```bash
# The two suites this track touches most
node --test conductor/tests/track-10020-orphan-reconcile-periodic.test.mjs
node --test conductor/tests/track-10020-run-marker.test.mjs

# Regression: the contracts this track must not break
node --test conductor/tests/track-10020-orphan-classify-crashed.test.mjs
node --test conductor/tests/track-1110-orphaned-dispatch.test.mjs
node --test conductor/tests/track-10040-stuck-track-sweep.test.mjs

# Full worker suite (expect two PRE-EXISTING failures in local-api-e2e —
# A/B against the merge-base before treating either as a regression)
node --test conductor/tests/
```

Suite conventions worth knowing before adding cases: the periodic suite shares
one temp project and one mock collector across its tests, so **every new case
needs its own unused track number** (colliding numbers broke two pre-existing
cases during commit `6799754`). Its windows are shortened via
`LC_ORPHAN_RECONCILE_GRACE_MS` / `LC_ORPHAN_RECONCILE_NO_MARKER_MS` (900ms each)
so a case can cross them in-test.

## Test Cases

### Phase 1 — systemd unit (manual, no automated harness)
- [x] TC-1.1: `KillMode=mixed` present in `[Service]` — expected: `systemd-analyze
      verify` accepts the unit and the directive is under `[Service]`, not `[Unit]`
      (the unit's own comment records a live case of misplaced directives being
      silently ignored). Ran `systemd-analyze --user verify
      conductor/systemd/laneconductor-worker@.service`: exit 0, no warnings.
- [ ] TC-1.2: worker restarted mid-lane-action under systemd — expected: `ps`
      shows the CLI child still running afterwards, and `conductor/.runs/<n>.json`
      still exists. **Not run**: this machine's installed unit
      (`~/.config/systemd/user/laneconductor-worker@.service`) doesn't have this
      fix deployed yet, and IS the live worker currently supervising other
      tracks' real in-flight lane actions — restarting it to test this would
      disrupt that unrelated work. Left for a human to run after deploying the
      updated unit file. See `plan.md` Phase 1 Task 1.2.
- [ ] TC-1.3: the replacement worker's orphan tick logs "Skipping — live run
      marker" for that track — expected: the dispatch stays `claimed` and is later
      finalized normally when the child exits, not reaped. Same deferral as
      TC-1.2 — depends on it having actually run.

### Phase 2 — marker survives finalization
- [x] TC-2.1 (unit): `markRunFinalizing` returns a marker with `finalizing: true`,
      an ISO `exited_at`, and the exit code, leaving `pid`/`worker_pid`/`command`
      intact — expected: round-trips through `parseRunMarker` unchanged.
- [x] TC-2.2 (unit): `classifyMarkerPhase` on a finalizing marker with a live
      `worker_pid` — expected: `finalizing-live`.
- [x] TC-2.3 (unit): same with a dead `worker_pid` — expected: `finalizing-dead`.
- [x] TC-2.4 (unit): a legacy marker with no `finalizing` field — expected:
      `running`, i.e. classified exactly as before this track.
- [x] TC-2.5 (integration): a dispatch whose marker is finalizing and whose
      `worker_pid` is a live process — expected: the dispatch stays `claimed`
      across several ticks; nothing is written to `conversation.md`.
- [x] TC-2.6 (integration): same marker with a dead `worker_pid`, claimed_at just
      past the ordinary grace window but well inside the no-marker window —
      expected: reconciled to `failed` in that window (proving REQ-5 does not wait
      out `LC_ORPHAN_RECONCILE_NO_MARKER_MS`), with a `⚠️` comment naming the
      action to re-run, and the marker deleted.
- [x] TC-2.7 (integration): a real spawned run that exits normally — expected: the
      marker exists throughout the exit handler and is gone once finalization
      completes; the dispatch reaches its terminal status exactly once.
- [x] TC-2.8 (integration): an exit handler that throws mid-finalization —
      expected: the marker is still removed (the `finally`), and the dispatch is
      left recoverable rather than double-finalized.

### Phase 3 — main-mode reconcile
- [x] TC-3.1: main-mode track (`**Workspace**: main` in the primary `index.md`),
      no worktree, no run marker, dead git-lock PID, claimed past the no-marker
      window, primary `index.md` reading `**Lane Status**: running` — expected:
      the dispatch is reconciled to `failed` and the stale lock is released.
      This case fails today (permanently `claimed`), which is the point.
- [x] TC-3.2: same main-mode track but the primary `index.md` shows a completed
      forward transition (`implement` → `review`) — expected: reconciled as `done`
      with `skipArtifactCopy` (nothing to copy — the files are already primary).
- [x] TC-3.3 (regression): branch-mode track with no worktree — expected:
      unchanged from today, skipped, dispatch untouched.
- [x] TC-3.4 (regression, REQ-7): the no-marker fallback runs on a track that is
      then skipped — expected: the git lock is **still present** afterwards; it is
      only removed once a reconcile decision is actually reached.

### Phase 4 — graceful shutdown
- [ ] TC-4.1: SIGTERM with a tracked child already dead — expected: that track's
      `.conductor/locks/<n>.lock` is gone after the process exits. **Not
      integration-tested** — see `plan.md` Task 4.3 for why this is a same-tick
      race with `runningTrackMap.delete(proc.pid)` rather than a reliably
      reproducible scenario. Covered by code inspection and by the identical
      own-pid/own-host dead-check pattern TC-3.1/TC-3.4 already exercise for
      orphan-reconcile's own lock release.
- [x] TC-4.2: SIGTERM with a tracked child still alive — expected: the lock is
      left in place, and the run marker carries `worker_shutdown_at`. See
      `track-10065-shutdown-locks.test.mjs`.
- [ ] TC-4.3: SIGTERM with a lock owned by a different PID or a different
      `machine` — expected: untouched. **Not integration-tested** — same
      reasoning as TC-4.1 (this branch of `releaseOwnLocksOnShutdown` is only
      reached once the dead-child check above it has already passed).
- [x] TC-4.4 (REQ-9): shutdown still completes within `LC_SHUTDOWN_DEADLINE_MS`
      with the sweep in place — expected: no measurable delay to exit, and a
      forced sweep error never blocks de-registration. Asserted directly in
      `track-10065-shutdown-locks.test.mjs` (`exitedAt - sigtermSentAt < 4000ms`
      against a 2000ms deadline).

### Cross-cutting regressions
- [x] TC-5.1: `track-10020-orphan-classify-crashed.test.mjs` TC-3.3 — expected:
      still byte-identical behavior when `runnerExited` is omitted (REQ-10).
- [x] TC-5.2: the two Track 10065 cases added by commit `6799754` — expected:
      still pass, including the conservative case (live lock PID, and a claim too
      recent to judge).
- [x] TC-5.3: `track-1110-orphaned-dispatch.test.mjs` in full — expected:
      unchanged; `classifyOrphanedDispatch`'s own semantics are a non-goal here.

## Acceptance Criteria
- [x] All test cases above pass — except TC-1.2/TC-1.3 (deferred live systemd
      verification, see Phase 1) and TC-4.1/TC-4.3 (deliberately not
      integration-tested, same-tick race — see Phase 4), both explained inline.
- [x] The full worker suite shows no new failures versus this branch's merge-base
      — see `plan.md` Task 5.2 for the investigation (a literal merge-base re-run
      wasn't viable on this shared host; every sampled failure has an independent
      environmental cause unconnected to the files this track touches).
- [ ] The live restart scenario from `spec.md`'s Problem Statement is reproduced
      and observed to self-recover, not just unit-tested. Deferred with
      TC-1.2/TC-1.3 — requires deploying the updated systemd unit and restarting
      the live, shared worker on this machine, which is currently supervising
      other tracks' real work.
