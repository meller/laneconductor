# Plan: Fix the Playwright E2E suite (Track 1100)

## Phase 1: Triage with real measurements

**Problem**: The only numbers we have are partial — one file timed, the
full suite abandoned at a 3-minute budget. Everything else is inference.
**Solution**: Run each spec file individually and write down what happens.

- [ ] Task 1: For each of the 6 files, run
      `npx playwright test <file> --reporter=line` and record: pass count,
      fail count, wall-clock time.
- [ ] Task 2: For each failure, capture the actual assertion error (the
      suite already saves screenshots/video on failure — use them rather
      than guessing at causes).
- [ ] Task 3: Classify each file: **fast+deterministic**, **slow by design**
      (drives a real agent/worker run), or **broken**.
- [ ] Task 4: Replace the placeholder baseline in `conductor/quality-gate.md`
      with these measured numbers.

## Phase 2: Fix or retire the failing worker-identity specs

**Problem**: 3 of 6 `worker-identity.spec.js` tests fail on worker-card
visibility-badge assertions. They date from track 1033; the UI has changed
since (track 1091 added a manager badge, track 1096 added CLI/model
controls to the same card).
**Solution**: Decide per test, with evidence.

- [ ] Task 1: For each of the 3, determine whether the assertion is stale
      (UI legitimately changed) or catching a real regression. Check the
      card's current DOM against what the spec expects.
- [ ] Task 2: If stale → update the assertion to the current UI, or delete
      the test and record *why* here. If a real regression → fix the app,
      not the test.
- [ ] Task 3: Re-run the file; it must be fully green before Phase 3.

## Phase 3: Tier the suite

**Problem**: One undifferentiated suite mixes ~45s deterministic UI checks
with 5-minute specs that poll real agent runs. Gating on all of it is
impractical; gating on none of it is what caused the 1084 review.
**Solution**: Two tiers, with the fast one wired into the gate.

- [ ] Task 1: Choose the mechanism — Playwright `projects` in
      `playwright.config.js`, or a tag convention (`@slow`) with
      `--grep-invert`. Prefer whichever keeps a *single* command in
      `quality-gate.md`.
- [ ] Task 2: Assign specs to tiers using Phase 1's classification.
      Expected slow tier: `brainstorm-concurrency.spec.js`,
      `brainstorm-concurrency-v2.spec.js`, `new-track-plan.spec.js`, and
      likely `track-1033-e2e.spec.js` — confirm against measurements
      rather than assuming.
- [ ] Task 3: Verify the fast tier meets REQ-3's ~2 minute target. If it
      doesn't, move specs rather than raising the target.
- [ ] Task 4: Verify the slow tier still passes when invoked explicitly —
      tiering must not become a quiet way to stop running them.

## Phase 4: Shared state / parallelism

**Problem**: `workers: 1` with the comment "tests share state (track
number)". If true, the suite can never parallelise; if it's stale, the
suite is needlessly ~6x slower than it needs to be.
**Solution**: Establish which it is.

- [ ] Task 1: Identify the actual shared state (grep the specs for the
      track number/fixture they share).
- [ ] Task 2: If it can be made per-spec (unique track number per test,
      cleaned up after), do it and raise `workers`.
- [ ] Task 3: If it genuinely can't, leave `workers: 1` and replace the
      comment with a concrete statement of what breaks — so the next
      person doesn't re-litigate this.

## Phase 5: Wire into the quality gate

- [ ] Task 1: Update `conductor/quality-gate.md`'s E2E line to the
      fast-tier command, with measured runtime and expected result.
- [ ] Task 2: Note the slow-tier command alongside it as opt-in, so it's
      discoverable rather than forgotten again.
- [ ] Task 3: **Prove the gate can fail** — temporarily break a UI element
      a fast-tier spec asserts on, confirm the tier fails, restore. Record
      what was broken and that it was restored. (A suite that passes but
      cannot fail is exactly the hazard this whole track exists to remove.)

## Context

Opened out of track 1084's Phase 6 quality-gate review (2026-08-12). The
same review found `conductor/quality-gate.md` shipping with every box
pre-ticked and `Status: PASS` pre-filled, which is why this suite was
never noticed as dead. That file has since been reset to unchecked with a
"checklist, not a report" warning, and `SKILL.md` now requires a real
product check — making this track a prerequisite for the gate to be
honest rather than merely stricter.
