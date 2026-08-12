# Tests: Track 1100 — Fix the Playwright E2E suite

## Test Commands

```bash
# Per-file triage (Phase 1) — run each, record pass/fail + wall time
npx playwright test brainstorm-concurrency.spec.js --reporter=line
npx playwright test brainstorm-concurrency-v2.spec.js --reporter=line
npx playwright test new-track-plan.spec.js --reporter=line
npx playwright test track-1033-e2e.spec.js --reporter=line
npx playwright test track-1033-sharing.spec.js --reporter=line
npx playwright test worker-identity.spec.js --reporter=line

# Fast tier (Phase 3 — exact command TBD by Phase 3 Task 1)
# Slow tier, opt-in (Phase 3)
```

Note: this track's "tests" are largely *measurements of other tests*. The
deliverable is a suite that runs and can fail honestly, so most cases below
are verified by observed runs rather than by new assertions.

## Test Cases

### Phase 1: Triage
- [ ] TC-1: All 6 spec files run individually without erroring at the
      runner level (a spec may fail its assertions — that's data, not a
      runner problem).
- [ ] TC-2: Pass/fail counts and wall-clock times recorded per file in
      `plan.md`.
- [ ] TC-3: `conductor/quality-gate.md`'s baseline replaced with those
      measured numbers — no remaining "as of 2026-08-12" placeholder text.

### Phase 2: worker-identity failures
- [ ] TC-4: `npx playwright test worker-identity.spec.js` → 0 failures.
- [ ] TC-5: For each of the 3 originally-failing tests, `plan.md` states
      whether it was fixed or removed, and why. A removal with no stated
      reason fails this case.
- [ ] TC-6: If any failure turned out to be a real app regression, the fix
      is in app code and a note explains what was broken (not a loosened
      assertion).

### Phase 3: Tiering
- [ ] TC-7: The fast tier completes in under ~2 minutes, exits 0, zero
      failures. Time it; don't estimate.
- [ ] TC-8: The fast tier contains no spec that drives a real agent/LLM
      run (grep for `setTimeout(300000)` / long poll deadlines as a
      cross-check).
- [ ] TC-9: The slow tier, invoked explicitly, still runs and passes.
- [ ] TC-10: Every one of the 19 specs belongs to exactly one tier — none
      silently dropped from both. Count them.

### Phase 4: Parallelism / shared state
- [ ] TC-11: If `workers` was raised: the fast tier still passes across 3
      consecutive runs (catches order-dependence that a single green run
      hides).
- [ ] TC-12: If `workers: 1` was kept: the config comment names the
      specific shared resource, not just "shared state".

### Phase 5: Gate wiring
- [ ] TC-13: Following only `conductor/quality-gate.md`, the E2E check can
      be run correctly by someone with no context on this track.
- [ ] TC-14: **Negative test — the gate can actually fail.** Break a UI
      element a fast-tier spec asserts on, run the tier, confirm it fails
      with a message that identifies the break. Restore, confirm green.
      Record both observations.

## Acceptance Criteria

- [ ] Fast tier: green, under ~2 min, wired into `quality-gate.md`
- [ ] Slow tier: green when invoked, discoverable in `quality-gate.md`
- [ ] No known-failing specs in the gating path
- [ ] TC-14 performed — a suite that has never been seen to fail is not
      evidence of anything
