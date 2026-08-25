# Track 1100: Make the Playwright E2E suite actually runnable in the quality gate

**Lane**: quality-gate
**Lane Status**: running
**Progress**: 90%
**Last Run**: mock (primary)
**Phase**: Quality gate FAIL (4th consecutive FAIL, same reason) — fast tier clean and now concurrency-proven; Gap 2 (slow tier never observed passing) still needs the human decision requested 4x in…
**Type**: dev
**Summary**: 19 Playwright specs exist but are effectively never run: the suite is sequential with multi-minute per-test budgets (worst case ~40min), and 3 of 6 worker-identity specs fail. The quality gate now…

## Problem

`conductor/tests/playwright/` holds 19 specs across 6 files. Nothing in the
workflow ran them — the one mention of Playwright in `SKILL.md` was an
aside about a missing command, and `conductor/quality-gate.md`'s E2E line
was pre-ticked `[x]` alongside a pre-filled `Status: PASS`, so it read as
already-satisfied. Track 1084's Phase 6 review (2026-08-12) made the
quality gate actually require a real-product check, which turns this dead
suite into a blocker: it can't gate anything in its current state.

**Measured 2026-08-12** (not assumed):

- `npx playwright test --list` → 19 tests, 6 files. Discovery works.
- `worker-identity.spec.js` alone: **3 passed, 3 failed in ~45s**. The 3
  failures all assert on worker-card visibility badges — pre-existing,
  unrelated to any track in flight.
- The full suite did **not** complete within a 3-minute budget. Initially
  written up as a "hang"; on inspection it is not one — see below.

**Root cause of the slowness (corrected diagnosis):** the suite isn't
hanging, it's legitimately long by construction:

- `playwright.config.js`: `workers: 1` (sequential — the comment says tests
  share state via track number) and `timeout: 180000` (3 min/test).
- Several specs raise their own ceiling further: `brainstorm-concurrency`
  and `new-track-plan` both `test.setTimeout(300000)` (5 min), and poll
  real worker runs with deadlines of 120–180s plus `waitForTimeout` sleeps
  of 5–10s.
- So worst case is roughly 19 sequential tests × multi-minute budgets —
  tens of minutes. That's not viable as a per-track gate.

There are really two problems, and they need separating: **specs that are
slow because they drive real agent runs** (brainstorm/planning — arguably
correct to be slow, but wrong to run on every track) versus **specs that
are simply broken** (the 3 visibility-badge failures).

## Solution

- Triage all 19 specs: passing / failing / slow-by-design.
- Fix the 3 worker-identity failures, or delete them if they assert UI that
  no longer exists (they date from track 1033).
- Split the suite so the quality gate can run a **fast tier** (seconds to
  ~2 min, deterministic, no real LLM calls) on every track, leaving the
  slow agent-driven specs to an explicit opt-in tier.
- Make the shared-state coupling explicit — `workers: 1` exists because
  specs share a track number. If that can be removed, the suite can
  parallelise; if not, document why.
- Update `conductor/quality-gate.md` to name the fast tier as the required
  command and record a real, current baseline.

## Phases
- [x] Phase 1: Triage — run each spec file individually, record pass/fail and wall-clock time per file. Replace the placeholder baseline in `quality-gate.md` with measured numbers.
- [x] Phase 2: Fix or retire the 3 failing `worker-identity.spec.js` visibility-badge tests (decide which, with evidence — the UI they assert on may have legitimately changed since track 1033).
- [x] Phase 3: Tier the suite — a fast/deterministic tier for the quality gate vs. an opt-in slow tier for the agent-driven specs (`brainstorm-concurrency*`, `new-track-plan`, `track-1033-e2e`). Likely Playwright projects or a grep/tag convention.
- [x] Phase 4: Investigate `workers: 1` — can the shared track-number state be removed so specs run in parallel? If not, document the constraint in the config comment.
- [x] Phase 5: Wire the fast tier into `conductor/quality-gate.md` as the required E2E command, with the measured runtime and expected result recorded.
- [ ] Phase 6 (open): observe the slow tier green under a real `sync+poll` worker, and decide how/whether to bring `track-1033-sharing.spec.js`'s 6 always-skipped tests into the gate.

## Result

`npx playwright test --project=fast` — **10 passed, 6 skipped, 0 failed in
~15s**, stable across 3 consecutive runs. Wired into `quality-gate.md` as
the required E2E check.

The 3 `worker-identity` failures were a **stale test precondition, not an
app regression**: they guarded on `GET /api/workers` (which includes
manager workers, `project_id NULL` by design) while the Workers grid
renders an empty state unless a *non-manager* worker exists. They now seed
their own worker and are deterministic. No app code changed.

Negative test performed (TC-14): breaking `worker-sharing-btn` in
`WorkersList.jsx` made the tier fail with a message naming the break;
restoring returned it to green with an empty `git diff`.

**Not at 100% on purpose.** Two things remain open — the slow tier has
never been *observed* passing (all 3 specs need
`lc worker start --sync-and-work`; this machine runs a sync-only manager),
and all 6 `track-1033-sharing` tests skip silently without a
`PW_TEST_MODE` server. Both are documented in `plan.md` and
`quality-gate.md` rather than papered over.

## Depends on
[1084](../1084-worker-identity-and-assignment/index.md) — its Phase 6 review added the real-product/E2E requirement to the quality gate, which is what makes this suite load-bearing. Specs under test originate from [1033](../1033-track-1033-worker-use-connection/index.md).

## Notes

Deliberately **not** fixed by loosening the quality gate. The gate was
weakened for exactly this kind of reason before (a pre-ticked checkbox
standing in for a real check), and that is how several tracks reached
`done` with features that didn't work. Until this track lands,
`quality-gate.md` records the honest measured baseline and treats a *new*
failure as a blocker while known-failing specs are not.
**Waiting for reply**: yes
