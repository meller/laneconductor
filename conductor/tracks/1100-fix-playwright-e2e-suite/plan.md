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
| `brainstorm-concurrency-v2.spec.js` | 1 | **1 failed** | **102.8s** | slow by design; needs a live sync+poll worker |

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

- [x] Task 1: Choose the mechanism — Playwright `projects` in
      `playwright.config.js`, or a tag convention (`@slow`) with
      `--grep-invert`. Prefer whichever keeps a *single* command in
      `quality-gate.md`.
- [x] Task 2: Assign specs to tiers using Phase 1's classification.
      Expected slow tier: `brainstorm-concurrency.spec.js`,
      `brainstorm-concurrency-v2.spec.js`, `new-track-plan.spec.js`, and
      likely `track-1033-e2e.spec.js` — confirm against measurements
      rather than assuming.
- [x] Task 3: Verify the fast tier meets REQ-3's ~2 minute target. If it
      doesn't, move specs rather than raising the target.
- [x] Task 4: Verify the slow tier still passes when invoked explicitly —
      tiering must not become a quiet way to stop running them.

### Mechanism: Playwright `projects` (chosen over `@slow` tags)

Both keep a single command, but `projects` also lets each tier carry its
own `timeout` — 60s for `fast` (a real ceiling; anything slower has picked
up a live-agent dependency and belongs in `slow`) vs 300s for `slow`. A
grep convention can't express that.

    npx playwright test --project=fast    # required, every track
    npx playwright test --project=slow    # opt-in

Assignment is by filename in `SLOW_SPECS`, so a new spec matching neither
list defaults to `fast` — it gets run rather than silently dropped.

**Task 2 correction:** the plan guessed `track-1033-e2e.spec.js` would be
slow. Measurement says otherwise — 4 passed in **2.0s**. It is named "e2e"
but never opens a browser; it's a pure collector-API test. It's in the fast
tier. This is exactly why Phase 1 required numbers rather than estimates.

**Tier counts verified with `--list`: 16 fast + 3 slow = 19.** Every spec
belongs to exactly one tier; none dropped (TC-10).

**Task 3:** fast tier measured at **~15s** against REQ-3's ~2 min target.

**Task 4 — honest result:** the slow tier does **not** currently pass, and
tiering is not the reason. All 3 specs need a `sync+poll` worker to claim a
queued track; this machine runs only a `sync-only` manager, so they fail
waiting for a claim that never arrives (`new-track-plan` ~71s,
`brainstorm-concurrency` ~137s). Same failures pre-date this track — they
are an unmet environment prerequisite, not a regression introduced by the
split. Now documented in `quality-gate.md` so the next person doesn't
rediscover it. Verifying them green under a real sync+poll worker is left
open (see Phase 5 open work).

## Phase 4: Shared state / parallelism

**Problem**: `workers: 1` with the comment "tests share state (track
number)". If true, the suite can never parallelise; if it's stale, the
suite is needlessly ~6x slower than it needs to be.
**Solution**: Establish which it is.

- [x] Task 1: Identify the actual shared state (grep the specs for the
      track number/fixture they share).
- [x] Task 2: If it can be made per-spec (unique track number per test,
      cleaned up after), do it and raise `workers`.
- [x] Task 3: If it genuinely can't, leave `workers: 1` and replace the
      comment with a concrete statement of what breaks — so the next
      person doesn't re-litigate this.

### Outcome: `workers: 1` kept — the constraint is real, and now named

The old comment ("tests share state (track number)") was true but too vague
to act on. The four concrete conflicts, verified by reading the specs:

1. `brainstorm-concurrency-v2.spec.js` hardcodes track numbers **991** and
   **992**, and creates/`rmSync`-deletes those directories under
   `conductor/tracks/` on the real filesystem.
2. `track-1033-e2e.spec.js` hardcodes track number **999** (the canary
   track) and creates then `DELETE`s it in the live DB.
3. `worker-identity.spec.js` and `track-1033-e2e.spec.js` both generate and
   revoke API keys **on the same project**, and worker-identity asserts on a
   before/after *row count* of `api-key-row`. Concurrent key mutation from
   the other file corrupts that count directly — this one would be a genuine
   flake, not a theoretical one.
4. The brainstorm/new-track specs drive the single real heartbeat worker and
   assert on its **concurrency limit**. Running them in parallel races the
   exact thing under test.

(1)–(3) are fixable per-spec; (4) is not, short of a second isolated worker.
But the payoff doesn't justify it: the fast tier is 3 files and ~15s total,
so parallelising would buy a couple of seconds in exchange for real
flakiness risk. Decision: keep `workers: 1`, write the reasons into the
config so this doesn't get re-litigated. That is now a 20-line comment in
`playwright.config.js` (TC-12).

**Determinism checked anyway** (TC-11's spirit, even though `workers` wasn't
raised): 3 consecutive fast-tier runs — 10 passed / 0 failed each, 16.6s /
15.7s / 15.3s. No order-dependence surfaced.

## Phase 5: Wire into the quality gate

- [x] Task 1: Update `conductor/quality-gate.md`'s E2E line to the
      fast-tier command, with measured runtime and expected result.
- [x] Task 2: Note the slow-tier command alongside it as opt-in, so it's
      discoverable rather than forgotten again.
- [x] Task 3: **Prove the gate can fail** — temporarily break a UI element
      a fast-tier spec asserts on, confirm the tier fails, restore. Record
      what was broken and that it was restored. (A suite that passes but
      cannot fail is exactly the hazard this whole track exists to remove.)

### TC-14 negative test — performed 2026-08-12

**Break**: renamed `data-testid="worker-sharing-btn"` →
`worker-sharing-btn-TEMPORARILY-BROKEN` at
`ui/src/components/WorkersList.jsx:378` (the real attribute the visibility
tests locate, not a synthetic one).

**Observed**: fast tier **failed — 3 failed, 6 skipped**, and the message
identified the break precisely rather than failing vaguely:

```
Locator: getByTestId('worker-card')
           .filter({ hasText: 'pw-e2e-worker' })
           .getByTestId('worker-sharing-btn')
Error: element(s) not found
```

**Restore**: reverted; `git diff ui/src/components/WorkersList.jsx` is
empty, confirming byte-identical restoration. Re-ran: **10 passed, 15.0s**.

The tier can fail, fails for the right reason, and returns to green. Before
this track the same three tests failed *permanently* against unbroken code,
which is indistinguishable from noise and is why they were ignored.

### Open work — deliberately not claimed as done

1. **`track-1033-sharing.spec.js` skips all 6 of its tests** unless the API
   server runs with `PW_TEST_MODE=true` (which makes it accept
   `MOCK_TOKEN_FOR_*` bearer tokens — reasonably not the default). It exits
   0, so it reads green while proving nothing. Flagged prominently in
   `quality-gate.md` so "10 passed, 6 skipped" isn't misread as 16 passing.
   Wiring a `PW_TEST_MODE` server into the gate is its own track.
2. **The slow tier has not been observed green.** All 3 specs need
   `lc worker start --sync-and-work`; this machine runs a `sync-only`
   manager, so they fail on an unmet prerequisite (pre-existing, not caused
   by the split). Confirming them green under a real sync+poll worker
   remains outstanding — hence this track is **not** at 100%.

## Context

Opened out of track 1084's Phase 6 quality-gate review (2026-08-12). The
same review found `conductor/quality-gate.md` shipping with every box
pre-ticked and `Status: PASS` pre-filled, which is why this suite was
never noticed as dead. That file has since been reset to unchecked with a
"checklist, not a report" warning, and `SKILL.md` now requires a real
product check — making this track a prerequisite for the gate to be
honest rather than merely stricter.

## ⚠️ Gaps — review 2026-08-12 (FAIL)

Review verdict: **FAIL**. Lane returned to `implement:queue` per
`workflow.json` `lanes.review.on_failure`.

### Gap 1 (blocking) — `seedWorker()` does not guarantee a clean starting visibility

Introduced by this track's own Phase 2 fix. `POST /worker/register`'s
`ON CONFLICT ... DO UPDATE SET` does **not** include `visibility`, so
re-registering the fixture with `visibility: 'private'` leaves a previously
Public fixture Public. Combined with the `toContainText('Private')`
precondition added in Phase 2, a mid-test failure wedges the fast tier red
until someone manually resets the row.

Observed, not inferred:

```
1) after seed:         1013 private
2) after PATCH public: 1013 public
3) after RE-seed:      1013 public    ← not reset
→ npx playwright test worker-identity.spec.js
  1 failed, 5 passed — Received string: "🌐Public" (line 226)
```

This is the same failure mode the track was opened to eliminate: a spec
failing permanently against unbroken code. Ambient-state dependence was
relocated, not removed.

**Fix**: have `seedWorker()` explicitly `PATCH
/api/workers/:id/visibility` to the requested value after registering, so
the precondition is enforced rather than assumed. Reproduce first by
seeding a Public fixture and watching the tier fail.

### Gap 2 (blocking as written) — slow tier still never observed green

`npx playwright test --project=slow` → **exit 1 after 308.7s**. Unchanged
prerequisite: needs `lc worker start --sync-and-work`. Needs a human
decision — the queue currently holds tracks 10003–10007 and others in
`plan queue` that a sync+poll worker would immediately begin executing.

### Gap 3 (minor) — `quality-gate.md` doesn't name the server start command

It requires the UI and API to be up but never says `make start-all`.
`product-guidelines.md` requires instructions to state the exact command.

## ✅ Gap 1 resolved — 2026-08-12 (implement pass 2)

`seedWorker()` now **enforces** the fixture's starting visibility instead of
assuming registration reset it: after `POST /worker/register` it issues
`PATCH /api/workers/:id/visibility` with the requested value. The comment in
the spec explains why this is not redundant with the `visibility` field sent
to `/worker/register` (that endpoint's `ON CONFLICT ... DO UPDATE SET` omits
the column), so the next reader doesn't "simplify" it back out.

Fixed test-first, against a deliberately dirty starting state:

| Step | State before run | Code | Result |
|---|---|---|---|
| Reproduce | fixture forced `public` | before fix | ❌ `1 failed, 5 passed` — `Received string: "🌐Public"` |
| Verify fix | fixture forced `public` | after fix | ✅ `6 passed (13.3s)` |
| Fast tier ×3 | fixture forced `public` each time | after fix | ✅ `10 passed` / `10 passed` / `10 passed` (14.5s / 13.8s / 14.1s) |

The tier now recovers from dirty state on its own, which is the property
that was missing. Gap 2 (slow tier) and Gap 3 (`make start-all` not named in
`quality-gate.md`) remain open.

## ✅ Gap 3 resolved — 2026-08-20 (implement pass 3)

`quality-gate.md`'s E2E section now names the exact command
(`make start-all`, plus `make api-start`/`make ui-start` for one service and
a `lc worker status` / `curl` check to avoid starting a second copy) instead
of just asserting the UI and API must be "up".

## Gap 2 — investigated further, still open, and now understood to be two separable problems

**This machine right now**: `ps aux` shows two ambient `--sync-only`
workers (`worker-number 2`, `worker-number 3`) plus live Vite/API instances
for several other worktrees (10018, and others) — i.e. genuinely busy,
multiple tracks in flight concurrently on shared infrastructure. That's not
a hypothetical risk, it's the observed state right now, which is exactly why
this needs a human call rather than a judgment call made unilaterally
inside an autonomous `implement` run.

Read all three slow specs closely (not just re-run them) to find what
`--only-tracks` (track 1109's claim-time allowlist, verified in
`conductor/laneconductor.sync.mjs` — genuinely enforced at claim, not just
documentation) would need to be scoped safely:

| Spec | How it gets a track number | Safely scopable with `--only-tracks` today? |
|---|---|---|
| `brainstorm-concurrency-v2.spec.js` | Hardcoded `991`/`992`, written straight to `conductor/tracks/` on disk | **Yes** — numbers are known before the worker starts |
| `brainstorm-concurrency.spec.js` (v1) | Clicks "New Track" in the live UI; number comes back from the POST response, so it's whatever the app's next-available counter assigns | **No** — can't pass `--only-tracks` before the number exists |
| `new-track-plan.spec.js` | Same UI-driven creation as v1 | **No** — same problem |

So Gap 2 is actually two different things, not one:

1. **v2 could be run safely today** (`lc worker start --sync-and-work
   --only-tracks 991,992 --once`) — the scoping mechanism genuinely can't
   touch tracks 10003–10007 or anything else queued. But even this "safe"
   path is not side-effect-free: it spawns a real Claude Code CLI planning
   run against a fake test track, in the same live `conductor/tracks/`
   directory the actual dashboard renders, and costs real API time. That's
   a shared/visible/costed action on the user's live system on their
   behalf — not something to trigger from an unattended `implement` pass
   without asking, even though it's provably scoped.
2. **v1 and `new-track-plan` can't be scoped at all as currently written.**
   The fix would be real — teach them to read back the created track number
   and spawn their own throwaway `--only-tracks <n> --once` worker rather
   than depending on an ambient `--sync-and-work` worker that has to be
   started externally. That's a legitimate design (turns "needs a
   pre-existing sync+poll worker" into "each spec brings its own scoped
   one," which would also make the slow tier runnable in CI). It's also a
   nontrivial rewrite of test control flow that's worth scoping and
   reviewing on its own, not something to improvise inside this pass.

**Not doing either without asking first** — both because of the review's
explicit "needs a human decision" and because independently I found this
touches real running Claude sessions and a live shared dashboard, which is
exactly the class of action this project's own operating guidance says to
confirm before taking. Recommendation, for whoever makes this call:
(a) approve running v2's already-scoped path as a one-off to at least prove
the worker/spec mechanics work at all, and/or (b) approve the v1/
`new-track-plan` self-scoping rewrite as its own reviewed change. Left open
either way — see conversation.md.

## ⚠️ Gap 4 (blocking) — review 2026-08-20: fast tier is not actually stable on this machine right now

Implement pass 3's conversation comment claimed "None of this changes the
fast tier (still required, still green)". Re-running it during review
falsifies that claim under the repo's real current conditions.

**Reproduction — `npx playwright test --project=fast`, four consecutive
runs, no code changes between them:**

| Run | Result | Failing spec |
|---|---|---|
| 1 | 3 failed, 8 passed, 6 skipped (53.0s) | `worker-identity.spec.js` — all 3 visibility-badge tests |
| 2 | 0 failed, 11 passed, 6 skipped (20.0s) | none |
| 3 | 1 failed, 10 passed, 6 skipped (41.4s) | `track-1112-worktree-panel.spec.js` |
| 4 | 0 failed, 11 passed, 6 skipped (27.9s) | none |

Two different spec files failed on two different runs. Both pass reliably
in isolation:
- `worker-identity.spec.js` alone: 6/6 passed, 21.6s (run twice).
- `track-1112-worktree-panel.spec.js` alone: 1/1 passed, ×3 runs, ~2–3s
  each.

**This is not the same failure Gap 1 fixed.** Gap 1 was a permanent
failure against unbroken code (ambient-visibility precondition). This is
intermittent — same code, same machine, different outcome per run — and
only surfaces when the full tier runs together on this machine's current
real load.

**Root cause, by evidence not guess:** `ps aux` at review time shows this
machine running several real ambient `--sync-only` workers (heartbeat
every 5s) plus multiple other worktrees' live Vite/API instances — the
exact "genuinely busy" state Gap 2's investigation already documented as
the machine's normal current condition, not a hypothetical. Two distinct
contention mechanisms, both plausible from the code:
1. `worker-identity.spec.js`'s visibility-badge assertions use a 10s
   timeout that's comfortably met in isolation (<4s) but apparently not
   always under load from the rest of the tier plus ambient activity.
2. `track-1112-worktree-panel.spec.js` (added after this track's own
   Phase 4 conflict analysis, so not covered by it) selects its target
   worker via `ORDER BY last_heartbeat DESC LIMIT 1` — on a machine with
   real workers heartbeating every 5s, that query can grab a real ambient
   worker instead of the one the test just seeded, and the real worker's
   own next heartbeat can overwrite the test's injected `worktrees` data
   before the UI assertion runs.

**Why this blocks, rather than being a shrug**: `quality-gate.md` states
"Any failure is a blocker" for this tier, and `test.md`'s TC-7/TC-11
record "3 consecutive runs, 10 passed / 0 failed each" as evidence of
determinism. That evidence does not reproduce today. A gate that fails
~50% of the time for reasons unrelated to the change under review trains
people to re-run instead of trust red — precisely the failure mode this
track's own Notes section says it exists to eliminate, just approached
from the opposite direction (false failures instead of false passes).

**Not fixed here** — review evaluates, it doesn't patch. Left for the next
implement pass. Two independent angles worth considering, not mutually
exclusive: (a) harden the specs against ambient concurrency — e.g.
`track-1112-worktree-panel.spec.js` should target a worker row it fully
owns rather than "most recently heartbeated," and any tight (~10s) UI
timeouts in the visibility tests may need to be more generous or
retry-friendly; (b) reconsider, as Gap 2's investigation already gestured
at, whether asserting against this specific shared live dev instance
(rather than an isolated project/DB) is the right execution model for a
tier that's meant to be a trustworthy per-track gate.

**Correction, added after the fact — a better-supported explanation
surfaced by "Review #3" below, written concurrently with this one:** that
review's 3 consecutive fast-tier runs came back clean (11/0/6, every time)
and it independently discovered that live `localhost:8090` serves the
**primary checkout**, not whichever worktree is running the command — so
both this review and Review #3 were, at the same time, running the
identical suite against the identical shared `:8090`/`:8091` backend,
using the identical hardcoded fixture identity
(`pw-e2e-worker`/`worker_number: 99`, same resolved `project_id`). Two
concurrent runs mutating and asserting on the same DB row via the same
hostname/worker_number is a far more direct and sufficient explanation for
the mixed results above than generic ambient background-worker load — and
it undercuts my "root cause: contention with ambient heartbeat activity"
framing as stated. The observations themselves (the four run outcomes,
the isolated-vs-integrated contrast) are real and stand as recorded above,
but readers should weight "two review passes collided on one hardcoded
fixture identity" over "the tier is inherently flaky under normal
ambient load" until it's re-measured with no concurrent run in flight.
That re-measurement is still worth doing before trusting this tier fully,
but the more actionable, better-supported fix is: give shared fixtures
(here and in `track-1112-worktree-panel.spec.js`) a run-unique identity
(e.g. a PID or random suffix in the hostname) so concurrent runs of the
*same* suite can't collide, rather than assuming the tier only ever runs
alone.

## track-1033-sharing.spec.js (6 skipped tests) — same shape of blocker, traced further

Enabling this tier requires the **live** `ui/server/index.mjs` — the same
process serving `:8091` for every other in-flight track on this machine
right now — to be restarted with `PW_TEST_MODE=true`
(`ui/server/auth.mjs:16`: `TEST_MODE = process.env.PW_TEST_MODE === 'true'`).
That flag makes the shared server accept mock bearer tokens; it is an
auth-bypass mode on infrastructure other people's work currently depends
on, for the duration of the test run. Not something to toggle unilaterally
on a shared instance. The clean fix is a dedicated `PW_TEST_MODE` server on
its own port for this one test file, not flipping the shared one — but
that's new infrastructure, and belongs in its own track rather than a
quiet addition here. Recorded, not built.

## ⚠️ Review #3 — 2026-08-20 (FAIL, one criterion, unchanged since review #2)

Re-verified everything re-verifiable in code rather than trusting prior
marks:

- Fast tier: **11 passed, 6 skipped, 0 failed**, 3 consecutive runs
  (~19-23s each). Count moved 10→11 since review #2 because track 1112
  later added `track-1112-worktree-panel.spec.js`, which defaulted into
  `fast` per `playwright.config.js`'s own stated design ("new spec matching
  neither list lands in fast by default") — not a regression from this
  track.
- Gap 1 (`seedWorker()` visibility): fix confirmed present
  (`worker-identity.spec.js`, `PATCH /api/workers/:id/visibility` call) and
  holding.
- Gap 3 (`make start-all` in `quality-gate.md`): confirmed present.
- TC-14 negative test re-run: **first attempt was a false pass** — broke
  the testid in this worktree's copy of `WorkersList.jsx` and the tier
  stayed green, because the live `:8090` Vite dev server serves the
  **primary checkout**, not this worktree. Redid it against the actually-
  served file: 3/17 failed naming the exact locator, restored, verified
  `git diff` empty and tier green again. Worth remembering for any future
  review of this track — editing the worktree copy alone proves nothing
  about the live UI.

**Verdict: still FAIL.** Gap 2 (slow tier never observed green) and
`track-1033-sharing`'s 6 always-skipped tests are unchanged from the last
implement pass's investigation above — no code change resolves them, both
require a human decision about touching live shared infrastructure. Per
`workflow.json` this transitions to `implement:queue`, but recording here
plainly: another automated implement pass has no new decision to act on,
and there is no working mechanism for a dev-track implement run to pause
and wait for a human reply (`Waiting for reply` only gates non-dev tracks
in the sync worker's implement-resume logic) — so the likely outcome
without direct human attention is repeated implement/review cycles with no
forward motion on this criterion.

**Also found, incidentally, on review, not something to fix here**: the
review comment this pass tried to post to `conversation.md` did not appear
in `track_comments` after 30s of polling (content stayed in the file,
`.conv-cursor` advanced near the end of it, but no corresponding DB row).
The equivalent comment from the *previous* implement pass is missing
entirely — present in this worktree's copy, absent from primary and from
`track_comments`. The same "file holds only its latest 'Triggering X...'
line" pattern was also observed, at the same time, on tracks 10017, 10018,
and 1102 — so this isn't specific to track 1100. Flagging because it means
an AI-authored comment can be silently lost before a human ever sees it,
which undercuts the human-in-the-loop mechanism Gap 2's resolution depends
on. Out of scope to fix from review; worth its own track.

## ❌ Quality Gate — 2026-08-20 (FAIL, same blocker as review)

Invoked directly on the track while it sat in `implement:queue` after
Review #3's FAIL. Ran the required checks for real rather than trusting
prior marks:

- Fast tier (required): **3 consecutive runs, 11 passed / 0 failed / 6
  skipped each, ~19-20s wall**, with no concurrent Playwright process
  running against the shared instance this time. This confirms Gap 4's
  correction — the earlier flakiness during review was two concurrent
  review passes colliding on one shared hardcoded fixture identity, not a
  standing defect in the tier itself. With that contention removed, the
  tier is clean and fast, comfortably under the ~2min target.
- Stub/deferred-work scan on this track's files: no hits.
- Slow tier: not run. No sync+poll worker running (`lc worker status`:
  stopped in this worktree); starting one would claim and begin executing
  this machine's real queued tracks, which is precisely the side-effecting
  action still awaiting your decision. Not taken unilaterally here either.

**Verdict: FAIL**, via the done-gate. spec.md's own acceptance criterion —
"the slow tier still runs and passes when explicitly invoked" — has never
been observed true. That's a stated requirement for this specific track,
not a deferred nice-to-have, so a clean fast tier alone can't clear the
gate. Per `workflow.json`'s `quality-gate.on_failure`, transitioned to
`plan:queue`. Substance is unchanged from Review #3: the only forward
motion available is the human decision on Gap 2 already requested twice
in `conversation.md`.

## ✅ Gap 4 resolved — 2026-08-24 (implement pass 4)

Fixed for real rather than re-documented — Gap 4's own suggested angle (a):
harden the two identified fixtures against ambient/concurrent contention.

**`worker-identity.spec.js`**: `FIXTURE_HOSTNAME` was the literal
`'pw-e2e-worker'`. Now `` `pw-e2e-worker-${process.pid}` ``, so two
concurrent invocations upsert different `(project_id, hostname,
worker_number)` rows instead of racing the same one.

**`track-1112-worktree-panel.spec.js`**: had two independent collision
sources, both fixed:
1. It picked whichever worker row was `ORDER BY last_heartbeat DESC LIMIT
   1` and mutated it directly — could grab a *real* ambient worker on this
   normally-busy machine, and `afterAll`'s "restore" could then stomp that
   worker's actual current state. Now registers its own dedicated fixture
   worker (same `POST /worker/register` pattern as `seedWorker()` above),
   keyed by a pid-unique hostname, and `afterAll` deletes the fixture row
   outright instead of trying to restore borrowed state.
2. Even with a unique worker/hostname, the seeded fake track numbers
   (`'19999'`/`'19998'`) were still hardcoded literals. The worktrees panel
   API (`fetchWorktreeRows` in `ui/server/index.mjs`) deliberately
   aggregates across every worker/host for the project — that's the
   feature — so two concurrent runs each seeding a card titled `#19999`
   both land in the same aggregated panel, and `getByText('#19999')`
   matches two elements. Made the fake track numbers pid-derived too
   (`TRACK_MERGEABLE`/`TRACK_STRANDED`), and scoped the "Mergeable"/
   "Stranded" badge-text assertions to each seeded card rather than
   page-wide, since the badge text itself is generic across any concurrent
   run's cards.

**Verified against the actual failure mode, not just re-run**: two
genuinely concurrent `npx playwright test --project=fast` invocations
(`&` + `wait`, not sequential):
- *Before this fix* (confirming Gap 4's diagnosis first): both concurrent
  runs failed identically — `getByText('#19999')` resolved to 2 elements,
  strict-mode violation.
- *After this fix*: both concurrent runs — **11 passed, 0 failed, 6
  skipped each**, exit 0/0.
- Sequential run afterward: unaffected, 11 passed, 0 failed, 6 skipped.

This directly answers Gap 4's open question in the affirmative: it *was*
fixture-identity collision, not inherent flakiness under ambient load, and
it's now provably fixed rather than merely better-explained.

Gap 2 (slow tier) and `track-1033-sharing` are unchanged and still require
the same human decision requested in review #3 / the quality-gate run —
nothing here touches live shared infrastructure or spawns a real agent
session, so none of it needed that approval.
