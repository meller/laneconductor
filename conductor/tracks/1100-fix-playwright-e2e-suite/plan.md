# Plan: Fix the Playwright E2E suite (Track 1100)

## Phase 1: Triage with real measurements

**Problem**: The only numbers we have are partial — one file timed, the
full suite abandoned at a 3-minute budget. Everything else is inference.
**Solution**: Run each spec file individually and write down what happens.

- [x] Task 1: For each of the 6 files, run
      `npx playwright test <file> --reporter=line` and record: pass count,
      fail count, wall-clock time.
- [x] Task 2: For each failure, capture the actual assertion error (the
      suite already saves screenshots/video on failure — use them rather
      than guessing at causes).
- [x] Task 3: Classify each file: **fast+deterministic**, **slow by design**
      (drives a real agent/worker run), or **broken**.
- [x] Task 4: Replace the placeholder baseline in `conductor/quality-gate.md`
      with these measured numbers.

### Measured results — 2026-08-12

All run individually from the repo root, UI on :8090 and API on :8091 up.
Wall clock via `/usr/bin/time`.

| Spec file | Tests | Result | Wall | Classification |
|---|---|---|---|---|
| `track-1033-e2e.spec.js` | 4 | 4 passed | **2.0s** | fast + deterministic (pure API, no browser) |
| `track-1033-sharing.spec.js` | 6 | 6 **skipped** | **1.7s** | fast, but never actually runs — see below |
| `worker-identity.spec.js` | 6 | 3 passed / **3 failed** | **47.2s** | broken (fixed in Phase 2) |
| `new-track-plan.spec.js` | 1 | **1 failed** | **70.7s** | slow by design; needs a live sync+poll worker |
| `brainstorm-concurrency.spec.js` | 1 | **1 failed** | **136.8s** | slow by design; needs a live sync+poll worker |
| `brainstorm-concurrency-v2.spec.js` | 1 | see Phase 3 note | ~120s cap | slow by design; needs a live sync+poll worker |

**The "hang" was never a hang** — confirmed. `npx playwright test --list`
enumerates all 19 in under a second. The suite is simply sequential
(`workers: 1`) with multi-minute per-test budgets.

**The 3 slow-tier failures share one cause and are NOT spec bugs**: each
waits for the heartbeat worker to claim a queued track, and the only worker
running on this machine is a `sync-only` **manager** (`lc worker status`),
which by design never polls the queue. `new-track-plan` says so in its own
assertion message: *"is lc-worker-start running?"*. These need
`lc worker start --sync-and-work` — an environment prerequisite, now
documented in `quality-gate.md` rather than left to be rediscovered.

**`track-1033-sharing.spec.js` skips all 6 tests, always**, unless the API
server is restarted with `PW_TEST_MODE=true`. It exits 0, so it reads as
green while proving nothing. Called out explicitly in `quality-gate.md`;
turning it on is left as open work (see Phase 5).

## Phase 2: Fix or retire the failing worker-identity specs

**Problem**: 3 of 6 `worker-identity.spec.js` tests fail on worker-card
visibility-badge assertions. They date from track 1033; the UI has changed
since (track 1091 added a manager badge, track 1096 added CLI/model
controls to the same card).
**Solution**: Decide per test, with evidence.

- [x] Task 1: For each of the 3, determine whether the assertion is stale
      (UI legitimately changed) or catching a real regression. Check the
      card's current DOM against what the spec expects.
- [x] Task 2: If stale → update the assertion to the current UI, or delete
      the test and record *why* here. If a real regression → fix the app,
      not the test.
- [x] Task 3: Re-run the file; it must be fully green before Phase 3.

### Verdict: stale **precondition**, not a stale assertion — and not an app bug

All 3 failed identically: `getByTestId('worker-sharing-btn')` not found
(10s timeout each — which is the entire 47.2s → 13.6s runtime difference).

Diagnosis, established by running the app rather than by reading it. Each
test guarded on `GET /api/workers` being non-empty, else skip. On this
machine that endpoint returns exactly one worker — a **manager**, whose
`project_id` is `NULL` by design (track 1091). But `WorkersList.jsx`
renders its "No Active Workers" empty state unless a **non-manager** worker
exists:

```js
const hasOwnWorkers = (workers || []).some(w => w.type !== 'manager');
```

So the guard saw a worker, declined to skip, and the assertions then ran
against an empty state. Proven both ways: a scratch spec confirmed
`worker-card` count `0` / `worker-sharing-btn` count `0` with only the
manager present, then `2` / `2` immediately after seeding one project
worker via `POST /worker/register` — with no change to app code.

Two further latent bugs found in the same tests while there:

1. They looked for the Workers grid but the default landing view renders
   `WorkersList` in its **`strip`** layout, which has no `worker-sharing-btn`
   at all. The button exists only in the `grid` (Workers view) layout.
2. `getByTestId('worker-sharing-btn').first()` targets whichever card sorts
   first by hostname — the *manager*. The "change visibility to public" test
   was therefore mutating real manager state as a side effect.

**Fixed, not deleted** (`conductor/tests/playwright/worker-identity.spec.js`):
- Replaced the ambient guard with `seedWorker()`, registering a dedicated
  `pw-e2e-worker` / `worker_number: 99` project worker over the same
  `POST /worker/register` endpoint a real worker uses. Deterministic, no
  skips, no dependence on what happens to be running locally. It upserts on
  `(project_id, hostname, worker_number)` so repeat runs reuse one row, and
  it ages out of the 60s heartbeat-freshness window on its own.
- `resolveProjectId()` looks the project up by name instead of hardcoding
  `project_id: 1`, which differs per machine.
- Scoped the badge to the fixture's own card
  (`getByTestId('worker-card').filter({ hasText: FIXTURE_HOSTNAME })`), so
  the manager is no longer mutated.
- Replaced fixed `waitForTimeout` sleeps with `expect(...).toContainText`
  polling.

No app code changed — there was no regression to fix. Result: **6 passed,
0 failed in 13.6s** (was 3 passed / 3 failed in 47.2s).

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
