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

# Fast tier — REQUIRED by the quality gate. Measured ~15s, 10 passed/6 skipped.
npx playwright test --project=fast

# Slow tier — opt-in. REQUIRES a sync+poll worker: lc worker start --sync-and-work
npx playwright test --project=slow
```

## Results — 2026-08-12

| Case | Verdict | Evidence |
|---|---|---|
| TC-1 | ✅ | all 6 files ran; no runner-level errors |
| TC-2 | ✅ | table in `plan.md` Phase 1 |
| TC-3 | ✅ | `quality-gate.md` baseline replaced with measured numbers |
| TC-4 | ✅ | `worker-identity.spec.js` → 6 passed, 0 failed (13.6s) |
| TC-5 | ✅ | all 3 fixed (not removed); cause written up in `plan.md` Phase 2 |
| TC-6 | ✅ n/a | not an app regression — stale precondition; no assertion loosened |
| TC-7 | ✅ | fast tier 15.3s / 15.7s / 15.3s, exit 0, 0 failures |
| TC-8 | ✅ | no `setTimeout(300000)` or agent-run polling in the fast tier |
| TC-9 | ❌ **not met** | slow tier fails on an unmet prerequisite — see below |
| TC-10 | ✅ | `--list`: 16 fast + 3 slow = 19 |
| TC-11 | ✅ | 3 consecutive fast-tier runs, 10 passed each |
| TC-12 | ✅ | `playwright.config.js` names 4 concrete conflicts |
| TC-13 | ✅ | `quality-gate.md` gives the command, prerequisites, and baseline |
| TC-14 | ✅ | negative test performed and restored — `plan.md` Phase 5 |

**TC-9 is the one unmet case — and its blocker has changed since the note above was written.**
A `sync+poll` worker now runs on this machine, so the original blocker (no worker exists to
claim the track) no longer applies; a live re-run on 2026-08-30 confirmed all 3 slow specs get
past the claim step and fail at a *different*, later guard:

```
Error: assertCheckoutSpawnable: clean the checkout first — the primary checkout has
uncommitted changes outside the scoped track folder(s) [...]: conductor/create-project-utils.mjs,
conductor/laneconductor.sync.mjs, ...
```

The slow tier's real prerequisite is **a running `sync+poll` worker AND a quiescent primary
checkout at the same time** — and those two are in structural tension on this machine: the
worker that satisfies the first requirement is, by design, autonomously executing other queued
tracks, which continuously dirties the checkout the second requirement needs to be clean. This
is a property of the machine's own operating mode, not a defect in this track's suite or
tiering. Not forced green: TC-9 remains genuinely unverified, and Phase 6 (self-scoping rewrite
that would remove this dependency entirely) stays documented as permanently open — see plan.md.

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
- [x] TC-15 (added implement pass 4, Gap 4): **Concurrent-safety —
      two `npx playwright test --project=fast` invocations launched truly
      concurrently (`&` + `wait`) must both pass.** Reproduced the failure
      first (both runs: `getByText('#19999')` strict-mode violation), fixed
      `worker-identity.spec.js` and `track-1112-worktree-panel.spec.js` to
      use pid-unique fixture identities (hostname + fake track numbers)
      instead of shared literals, re-ran concurrently: both 11 passed / 0
      failed / 6 skipped. See `plan.md`'s "Gap 4 resolved" section.

## Acceptance Criteria

- [ ] Fast tier: green, under ~2 min, wired into `quality-gate.md`
- [ ] Slow tier: green when invoked, discoverable in `quality-gate.md`
- [ ] No known-failing specs in the gating path
- [ ] TC-14 performed — a suite that has never been seen to fail is not
      evidence of anything
