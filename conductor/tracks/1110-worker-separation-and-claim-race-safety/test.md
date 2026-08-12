# Tests: Track 1110 — Worker process separation + atomic track claiming

## Test Commands
```bash
# This track's own tests
node --test conductor/tests/track-1110-claim-race.test.mjs

# Full regression surface (Phase 5) — anything touching the claim/spawn path
node --test conductor/tests/local-fs-e2e.test.mjs
node --test conductor/tests/track-1091-create-project-worker.test.mjs
node --test conductor/tests/track-1091-manager-worker.test.mjs
cd ui && npx vitest run server/tests/track-1084-worker-lifecycle.test.mjs server/tests/track-1033-worker-auth.test.mjs
```

## Test Cases

### Phase 1: Reproduction
- [ ] TC-1: Two `laneconductor.sync.mjs` processes started against one
      local-fs project directory with one queued track — expected (pre-fix):
      the shared claim marker shows more than one distinct pid having
      invoked the mock CLI for that track number, across repeated runs
      (the race is timing-dependent, so this is checked over N runs, not
      asserted deterministically pre-fix)
- [ ] TC-2: Observed reproduction rate recorded in plan.md's Phase 1 notes
      — establishes the pass threshold Phase 5's regression test must meet

### Phase 2: Worker separation (flock guard)
- [ ] TC-3: `lc worker start` twice in quick succession for the same
      identity → exactly one live `laneconductor.sync.mjs` process
      afterward; the second invocation reports "already running" and
      exits without spawning
- [ ] TC-4: `SIGKILL` the running worker (no graceful shutdown, pidfile
      left stale) → an immediate subsequent `lc worker start` succeeds
      and produces exactly one live process
- [ ] TC-5: `lc worker start --manager` twice in quick succession →
      same guarantee as TC-3 for the manager identity

### Phase 3: Claim atomicity — API mode
- [ ] TC-6: Two worker processes in local-api mode, one queued track →
      `POST /tracks/claim-queue` is called by both, but only one gets
      the track back in its response; only that one spawns a CLI run
- [ ] TC-7: `claimableSet` (1109's allowlist) and `claim-queue`'s own
      filtering agree — a track excluded by the allowlist is not claimed
      even though claim-queue's own query would otherwise return it
- [ ] TC-8: Existing `track-1033-worker-auth.test.mjs` claim-queue tests
      pass unmodified (contract unchanged)

### Phase 4: Claim atomicity — local-fs mode
- [ ] TC-9: Phase 1's TC-1 reproduction test, run post-fix — the shared
      claim marker shows exactly one pid per track number, across the
      same N repeated runs that showed the race pre-fix
- [ ] TC-10: A worker crashes (SIGKILL) mid-run, leaving its claim marker
      behind — on next `lc worker start`, the startup sweep clears stale
      markers for tracks not in `runningPids`, and the track becomes
      claimable again (not permanently stuck)

### Phase 5: Regression
- [ ] TC-11: `local-fs-e2e.test.mjs`'s existing parallelism/transition/
      retry tests still pass unmodified
- [ ] TC-12: Single-worker timing is unchanged — a project with exactly
      one live worker claims and starts a queued track within the same
      auto-launch tick window as before this track's changes (REQ-5)

## Acceptance Criteria
- [ ] All test cases above pass
- [ ] Phase 1's reproduction test (TC-1) is committed and demonstrably
      RED (or intermittently red across N runs) before Phase 2-4's fixes
      land, and reliably green after
- [ ] No regressions in `local-fs-e2e.test.mjs`, `track-1091-*`,
      `track-1084-*`, or `track-1033-worker-auth.test.mjs`
