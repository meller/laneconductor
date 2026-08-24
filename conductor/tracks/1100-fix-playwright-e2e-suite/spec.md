# Spec: Make the Playwright E2E suite runnable in the quality gate (Track 1100)

## Problem Statement

19 Playwright specs exist in `conductor/tests/playwright/` and are
effectively dead code. Nothing in the workflow ran them, and
`conductor/quality-gate.md`'s E2E line shipped pre-ticked next to a
pre-filled `Status: PASS` verdict, so it read as already satisfied.

Track 1084's Phase 6 review (2026-08-12) added a genuine real-product
requirement to the quality gate — precisely because every UI bug found
that day had green unit tests. That makes this suite load-bearing, and it
cannot bear load today:

- Sequential by config (`workers: 1`) with a 3-minute default per-test
  timeout; two specs raise their own to 5 minutes and poll real worker
  runs with 120–180s deadlines. Worst case is tens of minutes.
- 3 of the 6 `worker-identity.spec.js` tests fail (visibility-badge
  assertions dating from track 1033).

## Requirements

**REQ-1: Measured triage, not estimates**
- Every spec file gets run individually with recorded pass/fail counts and
  wall-clock time. No "should be fast" claims — numbers only.

**REQ-2: No known-failing specs left in the gating tier**
- The 3 failing `worker-identity` tests are either fixed or removed with a
  written reason. "Removed because the UI legitimately changed" is an
  acceptable outcome; silently skipping them is not.

**REQ-3: A fast tier the quality gate can actually run every track**
- Deterministic, no real LLM/agent runs, no dependence on a live worker
  completing a lane action.
- Target: completes in **under ~2 minutes** on this machine.
- Slow agent-driven specs (`brainstorm-concurrency*`, `new-track-plan`,
  `track-1033-e2e`) move to an explicitly opt-in tier — they are valuable
  but wrong to run on every track.

**REQ-4: The shared-state constraint is resolved or documented**
- `workers: 1` exists because specs share a track number. Either remove
  that coupling so the suite can parallelise, or leave the setting with a
  comment stating concretely what breaks without it.

**REQ-5: quality-gate.md reflects reality**
- Names the fast-tier command as the required E2E check.
- Records the measured runtime and the expected result at the time of
  writing, so a future run can tell "new failure" from "known state".

## Acceptance Criteria

Written as observable outcomes — a criterion satisfied by scaffolding
(e.g. "a tier exists", "the config has a comment") does not count.

- [ ] Running the documented fast-tier command from a clean checkout
      completes in under ~2 minutes and exits 0, with no failing specs.
- [ ] `worker-identity.spec.js` has no failing tests: each of the 3
      current failures is either passing, or gone with its removal
      justified in `plan.md`.
- [ ] The slow tier still runs and passes when explicitly invoked — moving
      specs out of the default path must not quietly break them.
- [ ] A developer following `conductor/quality-gate.md` alone can run the
      E2E check correctly without prior knowledge of this track.
- [ ] Deliberately catching a regression: temporarily break a UI element a
      fast-tier spec covers, confirm the tier **fails**, then restore. A
      suite that passes but cannot fail is worthless as a gate.

## Non-Goals

- Rewriting the agent-driven specs to be fast. Driving a real planning run
  is inherently slow; the fix is tiering, not faking it.
- Adding new E2E coverage for features this track didn't touch. Making the
  existing suite trustworthy comes first.
