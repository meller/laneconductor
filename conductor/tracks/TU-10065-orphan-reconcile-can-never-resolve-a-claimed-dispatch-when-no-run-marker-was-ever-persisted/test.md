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
- [ ] TC-1.1: `KillMode=mixed` present in `[Service]` — expected: `systemd-analyze
      verify` accepts the unit and the directive is under `[Service]`, not `[Unit]`
      (the unit's own comment records a live case of misplaced directives being
      silently ignored).
- [ ] TC-1.2: worker restarted mid-lane-action under systemd — expected: `ps`
      shows the CLI child still running afterwards, and `conductor/.runs/<n>.json`
      still exists.
- [ ] TC-1.3: the replacement worker's orphan tick logs "Skipping — live run
      marker" for that track — expected: the dispatch stays `claimed` and is later
      finalized normally when the child exits, not reaped.

### Phase 2 — marker survives finalization
- [ ] TC-2.1 (unit): `markRunFinalizing` returns a marker with `finalizing: true`,
      an ISO `exited_at`, and the exit code, leaving `pid`/`worker_pid`/`command`
      intact — expected: round-trips through `parseRunMarker` unchanged.
- [ ] TC-2.2 (unit): `classifyMarkerPhase` on a finalizing marker with a live
      `worker_pid` — expected: `finalizing-live`.
- [ ] TC-2.3 (unit): same with a dead `worker_pid` — expected: `finalizing-dead`.
- [ ] TC-2.4 (unit): a legacy marker with no `finalizing` field — expected:
      `running`, i.e. classified exactly as before this track.
- [ ] TC-2.5 (integration): a dispatch whose marker is finalizing and whose
      `worker_pid` is a live process — expected: the dispatch stays `claimed`
      across several ticks; nothing is written to `conversation.md`.
- [ ] TC-2.6 (integration): same marker with a dead `worker_pid`, claimed_at just
      past the ordinary grace window but well inside the no-marker window —
      expected: reconciled to `failed` in that window (proving REQ-5 does not wait
      out `LC_ORPHAN_RECONCILE_NO_MARKER_MS`), with a `⚠️` comment naming the
      action to re-run, and the marker deleted.
- [ ] TC-2.7 (integration): a real spawned run that exits normally — expected: the
      marker exists throughout the exit handler and is gone once finalization
      completes; the dispatch reaches its terminal status exactly once.
- [ ] TC-2.8 (integration): an exit handler that throws mid-finalization —
      expected: the marker is still removed (the `finally`), and the dispatch is
      left recoverable rather than double-finalized.

### Phase 3 — main-mode reconcile
- [ ] TC-3.1: main-mode track (`**Workspace**: main` in the primary `index.md`),
      no worktree, no run marker, dead git-lock PID, claimed past the no-marker
      window, primary `index.md` reading `**Lane Status**: running` — expected:
      the dispatch is reconciled to `failed` and the stale lock is released.
      This case fails today (permanently `claimed`), which is the point.
- [ ] TC-3.2: same main-mode track but the primary `index.md` shows a completed
      forward transition (`implement` → `review`) — expected: reconciled as `done`
      with `skipArtifactCopy` (nothing to copy — the files are already primary).
- [ ] TC-3.3 (regression): branch-mode track with no worktree — expected:
      unchanged from today, skipped, dispatch untouched.
- [ ] TC-3.4 (regression, REQ-7): the no-marker fallback runs on a track that is
      then skipped — expected: the git lock is **still present** afterwards; it is
      only removed once a reconcile decision is actually reached.

### Phase 4 — graceful shutdown
- [ ] TC-4.1: SIGTERM with a tracked child already dead — expected: that track's
      `.conductor/locks/<n>.lock` is gone after the process exits.
- [ ] TC-4.2: SIGTERM with a tracked child still alive — expected: the lock is
      left in place, and the run marker carries `worker_shutdown_at`.
- [ ] TC-4.3: SIGTERM with a lock owned by a different PID or a different
      `machine` — expected: untouched.
- [ ] TC-4.4 (REQ-9): shutdown still completes within `LC_SHUTDOWN_DEADLINE_MS`
      with the sweep in place — expected: no measurable delay to exit, and a
      forced sweep error never blocks de-registration.

### Cross-cutting regressions
- [ ] TC-5.1: `track-10020-orphan-classify-crashed.test.mjs` TC-3.3 — expected:
      still byte-identical behavior when `runnerExited` is omitted (REQ-10).
- [ ] TC-5.2: the two Track 10065 cases added by commit `6799754` — expected:
      still pass, including the conservative case (live lock PID, and a claim too
      recent to judge).
- [ ] TC-5.3: `track-1110-orphaned-dispatch.test.mjs` in full — expected:
      unchanged; `classifyOrphanedDispatch`'s own semantics are a non-goal here.

## Acceptance Criteria
- [ ] All test cases above pass
- [ ] The full worker suite shows no new failures versus this branch's merge-base
- [ ] The live restart scenario from `spec.md`'s Problem Statement is reproduced
      and observed to self-recover, not just unit-tested
