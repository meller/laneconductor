# Spec: Slow-tier Playwright specs need self-scoped workers

## Problem Statement

Follow-up from track 1100 Review #3's Gap 2 and the track-1033-sharing findings
(2026-08-20). Both blockers on the slow Playwright tier share one root cause: the
specs depend on **shared live infrastructure** rather than bringing their own.

1. **v1 / new-track-plan self-scoping.** `brainstorm-concurrency.spec.js` and
   `new-track-plan.spec.js` create tracks through the live UI, so the track number
   isn't known before the run starts and can't be handed to track 1109's
   `--only-tracks` allowlist ahead of time. They therefore require an ambient
   `lc worker start --sync-and-work` worker that can claim *anything* queued —
   which both pollutes the assertions (other tracks' runs count toward the
   concurrency limit under test) and makes the tier unrunnable in CI, where no
   ambient worker exists. `brainstorm-concurrency-v2.spec.js` already works
   because it hardcodes 991/992; the `--only-tracks` mechanism itself was verified
   sound live on 2026-08-20.

2. **Dedicated `PW_TEST_MODE` server.** `track-1033-sharing.spec.js` (6 tests)
   always skips. Running it means restarting the *live shared*
   `ui/server/index.mjs` on `:8091` with `PW_TEST_MODE=true` — an auth-bypass mode
   on infrastructure every other in-flight track depends on. Not something to
   toggle unilaterally.

Both were explicitly scoped out of track 1100 ("not something to improvise inside
this pass") and filed here as the reviewed change they call for.

### Findings from code inspection (2026-08-25) — these shape the design

Reading the actual claim path turned up four hazards that a naive "just spawn
`lc worker run <n>`" rewrite would walk straight into. Each is verified in code,
with the file/line, and each drives a requirement below.

| # | Finding | Evidence | Consequence if ignored |
|---|---------|----------|------------------------|
| F1 | `auto_run` defaults to **false**, and `--only-tracks` does **not** bypass it — the allowlist narrows only | `conductor/claim-scope.mjs:87-89`; `parseAutoRun` defaults false at `laneconductor.sync.mjs:1496` | A UI-created track is never claimed by the scoped worker |
| F2 | `--once` termination looks only at `**Lane Status**` (`queue`/`running`), **not** at claimability | `remainingScopedWork()` at `laneconductor.sync.mjs:7012-7028` | With F1, the worker neither claims nor exits — it **hangs** until Playwright's 300s timeout, with no useful error |
| F3 | The sync script **unconditionally overwrites `conductor/.sync.pid`** when `worker_number === 1`, and `lc worker run` defaults to 1 | `laneconductor.sync.mjs:1232`; `bin/lc.mjs:1829-1834` | A throwaway worker clobbers the ambient worker's pidfile — `lc worker stop`/`status` then target a dead PID and the real worker becomes unmanageable. Exactly the "don't disturb shared infra" failure this track exists to prevent |
| F4 | The `plan` lane always runs **main-direct**, and a main-mode spawn is **refused** when the primary checkout has uncommitted changes outside the track's own folder — the track is re-queued and retried forever | `laneconductor.sync.mjs:4206-4217`; visible live in this track's own `conversation.md` | In any dirty dev checkout the plan run never starts; combined with F2 the spec hangs rather than reporting *why* |

Two smaller defects found in passing, both in scope:

- **F5 — stale assertion.** `brainstorm-concurrency-v2.spec.js:104` **and**
  `brainstorm-concurrency.spec.js:140` both assert `conversation.md` contains
  `> **assistant**:`. No writer in the codebase ever emits that author; the real
  writer emits `> **claude**:` (`laneconductor.sync.mjs:4826,4850`). Both report a
  false failure on a run that actually succeeded. The track description noted this
  for v2 only — v1 has the identical bug.
- **F6 — specs leak fixtures.** `conductor/tracks/` currently holds
  `8001-concurrency-a-*`, `8003-*`, `8004-*` and six `_duplicate-*` directories
  left behind by earlier runs of these very specs. Neither spec cleans up what it
  creates.

Also noted, **out of scope** (recorded so it isn't rediscovered):
`conductor/tests/playwright/global-setup.js` exists but `playwright.config.js`
declares no `globalSetup` key — it is dead code today. Not this track's business.

## Requirements

### Item 1 — self-scoped workers

- **REQ-1**: A shared helper module (`conductor/tests/playwright/helpers/scoped-worker.mjs`)
  exposes the create-track → scope-a-worker → wait → clean-up cycle, so no spec
  reimplements it. `new-track-plan.spec.js` and `brainstorm-concurrency.spec.js`
  currently carry near-duplicate copies of `createTrack`/`getTrackByNumber`; those
  collapse into the helper.
- **REQ-2** (F1): The helper enables `auto_run` on every track it intends the
  scoped worker to claim, before spawning it — via
  `PATCH /api/projects/:id/tracks/:num/auto-run` (`ui/server/index.mjs:4459`),
  which also writes the `**Auto Run**` marker back to `index.md` so the worker's
  file-side read sees it.
- **REQ-3** (F3): The helper spawns with a **run-unique `--worker-number` that is
  never 1**, so it writes `conductor/.sync-<N>.pid` and registers its own workers
  row. The ambient worker's pidfile, lock-target file, and token store are left
  untouched. The number is derived per run (not a fixed constant) so two
  concurrent runs of the same suite can't collide either — the same lesson track
  1100 Review #3 recorded about `pw-e2e-worker`/`worker_number: 99`.
- **REQ-4** (F2): Every wait the helper performs is bounded and, on expiry, fails
  with a diagnostic naming the actual stuck state (lane, lane status, auto_run,
  and the tail of the scoped worker's log) — never a bare timeout.
- **REQ-5** (F4): Before spawning, the helper checks the same condition the worker
  checks (`git status --porcelain`, filtered to paths outside the track's own
  folder and excluding worker bookkeeping) and fails immediately with "clean the
  checkout first" if it would be refused. It additionally watches the track's
  `conversation.md` for the `⚠️ Main-mode run blocked` marker and aborts on it.
- **REQ-6** (F6): The helper removes what it created — kills the scoped worker
  (SIGTERM, then SIGKILL after a grace period), deletes the track directory, and
  deletes the DB row — in a path that runs even when the test body throws.
- **REQ-7**: `new-track-plan.spec.js` uses the helper and passes with **no ambient
  worker running**.
- **REQ-8**: `brainstorm-concurrency.spec.js` uses the helper, scoping **one**
  worker to **both** created tracks so the plan-lane `parallel_limit: 1` assertion
  is still exercised — and is now hermetic, since no other track can be claimed
  into the count.
- **REQ-9** (F5): The `> **assistant**:` assertion is corrected to `> **claude**:`
  in both `brainstorm-concurrency.spec.js` and `brainstorm-concurrency-v2.spec.js`.

### Item 2 — dedicated PW_TEST_MODE server

- **REQ-10**: A helper (`conductor/tests/playwright/helpers/test-server.mjs`)
  starts `ui/server/index.mjs` as a child process with `PW_TEST_MODE=true` on its
  own port, waits for `/api/health`, and stops it afterwards. It must set
  `COLLECTOR_URL` to its **own** address — `ui/server/index.mjs:37` defaults
  `COLLECTOR_URL` to `http://127.0.0.1:8091`, so a second server left at the
  default would write straight back through the shared instance and defeat the
  isolation. It must not touch `ui/.api.pid` or `ui/.api.log` (spawning the script
  directly rather than via `lc api start` already avoids this — the assertion is
  that it stays that way).
- **REQ-11**: `track-1033-sharing.spec.js` runs its 6 tests against that dedicated
  server instead of skipping, with the shared `:8091` instance untouched and still
  serving throughout.
- **REQ-12**: `playwright.config.js` tier assignment and
  `conductor/quality-gate.md` are updated to match reality, and the slow tier's
  documented prerequisite changes from "requires a running sync+poll worker" to
  "brings its own".

## Acceptance Criteria

Each criterion is a user-observable outcome. None is satisfiable by a stub.

- [ ] **AC-1**: With **no ambient worker running** (`lc worker stop` first,
      `lc worker status` reports STOPPED), `npx playwright test --project=slow`
      passes all specs in the tier. This is the criterion the whole track exists
      for — it is what makes the tier CI-runnable. **Not achieved live** across
      either the implement or quality-gate sessions — both blocked by the
      primary checkout's own genuine concurrent activity from other in-flight
      tracks (`assertCheckoutSpawnable` correctly refusing to spawn against it,
      by design). Every mechanism this criterion depends on is independently
      verified live below; see test.md's Verification Log for full detail.
- [x] **AC-2**: During an AC-1 run, `lc worker status` still reports the ambient
      worker's own state correctly afterwards, and `conductor/.sync.pid` is
      unchanged from before the run (F3 regression guard — compare the file's
      contents before and after). Verified: `deriveWorkerNumber` unit-tested to
      never return 1 across 1000 PIDs; every live scoped spawn this session used
      a 9000-9999 worker number, writing only `.sync-<N>.pid`.
- [x] **AC-3**: After an AC-1 run, `conductor/tracks/` contains no new directories
      and `GET /api/projects/1/tracks` returns no new rows versus before the run
      (F6). Verified live, including after fixing a real bug found during
      quality-gate: `cleanup()` fell back to the wrong `projectRoot` when
      `handle` was null (the exact case when `assertCheckoutSpawnable` throws
      before the worker spawns), silently leaving directories/DB rows behind.
      Fixed and reproduced clean twice post-fix.
- [x] **AC-4**: Running `new-track-plan.spec.js` against a track whose `auto_run`
      was deliberately left false fails within ~30s with a message naming
      `auto_run` as the reason — not a 300s hang (F1+F2 regression guard).
      Live-verified during quality-gate via a direct reproduction (bypassing
      the UI, since this doesn't need a clean primary checkout): failed after
      ~30-32s with a diagnostic naming `auto_run`.
- [x] **AC-5**: Running the slow tier with a deliberately dirty primary checkout
      fails within ~30s with a message naming the dirty paths — not a hang (F4).
      Verified live four times total across both sessions: once against a
      deliberately dirtied file, three times naturally against this
      environment's genuinely dirty primary checkout — every time in seconds,
      every offending path named.
- [x] **AC-6**: A real brainstorm reply is detected by the corrected assertion: on
      a passing run, the spec's own assertion goes green on the same
      `conversation.md` content that previously produced a false failure (F5).
      Verified live (2026-08-20, referenced in Problem Statement) plus
      unit-tested (TC-2) against real `> **claude**:`/`> **human**:`-only
      fixtures.
- [x] **AC-7**: `npx playwright test track-1033-sharing.spec.js` reports
      **6 passed, 0 skipped**, while a `curl http://localhost:8091/api/health`
      issued during the run succeeds and the shared server's PID is unchanged
      before/after (REQ-10, REQ-11). Verified live, standalone and inside the
      full fast-tier run, in both sessions.
- [x] **AC-8**: The dedicated test server is gone after the run — nothing is
      listening on its port, and no orphaned `node ui/server/index.mjs` process
      remains. Verified live: `stopTestServer` confirms the port is free after
      shutdown.
- [x] **AC-9**: `npx playwright test --project=fast` still passes with no
      regression in its pass count, and its runtime stays under the tier's 60s
      per-test ceiling. Verified live in quality-gate: 28-29/29 passed across
      repeated runs; the 1-2 intermittent failures are `track-10018`/
      `track-1112`-worktree-panel dispatch-row-count tests this track never
      touched, reproduce identically on the primary checkout, and are a
      pre-existing flakiness class already documented in track 1096's own
      quality-gate.md. Net pass count is up (6 previously-skipped sharing
      tests now pass).

## API Contracts / Data Models

No schema changes. Endpoints consumed (all existing):

| Endpoint | Use |
|----------|-----|
| `POST /api/projects/:id/tracks` | track creation via UI; response carries `track_number` |
| `PATCH /api/projects/:id/tracks/:num/auto-run` | REQ-2 — opt the track into auto-claim |
| `GET /api/projects/:id/tracks` | polling lane/lane_action_status |
| `DELETE /api/projects/:id/tracks/:num` | REQ-6 cleanup |
| `GET /api/health` | REQ-10 readiness probe |

Worker invocation contract (existing, unchanged):
`node conductor/laneconductor.sync.mjs --only-tracks <csv> --once --worker-number <N>`

## Open Items for Human Review

None — no conflict found with `product.md`, `tech-stack.md`, `workflow.md`, or
`design-language.md`. `tech-stack.md` lists Playwright for UI flows as *planned*;
this track keeps that direction rather than contradicting it, and item 2's
spawn-a-server-per-spec-file pattern matches the zero-dependency, spawn-real-
processes approach `tech-stack.md` already prescribes for `node:test` E2E.
