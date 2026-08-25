# Track 10021: Slow-tier Playwright specs need self-scoped workers

**Problem**: The slow Playwright tier depends on shared live infrastructure — an
ambient `--sync-and-work` worker that can claim any queued track, and the shared
`:8091` API server. See `spec.md` for the full statement and the F1–F6 findings
that shape the design below.

**Solution**: Give the specs their own infrastructure. Item 1: a helper that
creates a track through the UI, reads back its number, opts it into `auto_run`,
and spawns a throwaway worker scoped to exactly that track under a run-unique
worker number. Item 2: a helper that spins up a dedicated `PW_TEST_MODE` API
server on its own port for `track-1033-sharing.spec.js` only.

Phases are ordered so the cheapest correctness fix lands first and each later
phase is verifiable on its own.

---

## Phase 1: Fix the stale conversation-format assertions

**Problem**: F5 — both brainstorm specs assert `conversation.md` contains
`> **assistant**:`, an author string no writer in the codebase emits. The real
writer emits `> **claude**:` (`laneconductor.sync.mjs:4826,4850`). Both therefore
report a false failure on a run that actually succeeded. Fixing this first means
every later phase is measured against an assertion that can actually go green.

**Solution**: Correct the string in both specs. Assert against the author set the
protocol actually defines (`claude`, `gemini`) rather than one hardcoded value, so
a project configured with a different primary CLI doesn't reintroduce the same
false failure.

- [x] Task 1: `brainstorm-concurrency-v2.spec.js:104` — replace the
      `> **assistant**:` check with a match on `> **claude**:` / `> **gemini**:`
- [x] Task 2: `brainstorm-concurrency.spec.js:140` — same fix (the track
      description flagged v2 only; v1 has the identical bug)
- [x] Task 3: The corrected regex is unit-tested (TC-2) against real
      `> **claude**:` / `> **human**:`-only fixtures and discriminates
      correctly. Re-running v2 itself the original 2026-08-20 way was
      superseded once v2 moved onto the self-scoped path in Phase 2/4 — see
      test.md's Verification Log for what was and wasn't achieved live for
      v2 specifically
- [x] Task 4: Commit `fix(track-10021): correct stale conversation author assertion`

**Impact**: v2 stops lying. Establishes the ground truth every later phase asserts
against.

---

## Phase 2: `scoped-worker.mjs` helper

**Problem**: There is no way for a spec to bring its own worker. The two hazards
that make a naive implementation fail silently (F1 `auto_run` defaults false and
`--only-tracks` cannot override it; F2 `--once` looks only at `**Lane Status**`,
so a never-claimable track produces a hang rather than an exit) plus the two that
make it damage shared state (F3 pidfile clobber; F4 main-mode dirty-checkout
refusal) all have to be handled in one place, not per spec.

**Solution**: `conductor/tests/playwright/helpers/scoped-worker.mjs`, a
zero-dependency ESM module in the same spirit as `conductor/tests/mock-collector.mjs`.

- [x] Task 1: `createTrackViaUI(page, { title, description, projectId })` — drives
      the New Track modal, intercepts the `POST .../tracks` response, returns
      `{ trackNumber, trackDir }`. Absorbs the duplicated `createTrack` from both
      specs. Resolves `trackDir` by number-prefix match, tolerating both the
      legacy `NNN-slug` and the `INITIALS-NNN-slug` layouts
- [x] Task 2: `enableAutoRun(request, projectId, trackNumber)` — REQ-2; PATCHes
      `/api/projects/:id/tracks/:num/auto-run` and then confirms the
      `**Auto Run**: yes` marker actually landed in `index.md` before returning,
      since the worker reads the file side
- [x] Task 3: `assertCheckoutSpawnable(trackDirNames)` — REQ-5; mirrors the
      worker's own filter (`laneconductor.sync.mjs:4206`) over
      `git status --porcelain` and throws a "clean the checkout first" error
      listing the offending paths
- [x] Task 4: `spawnScopedWorker(trackNumbers, opts)` — REQ-3; spawns
      `node conductor/laneconductor.sync.mjs --only-tracks <csv> --once
      --worker-number <N>` with a run-unique `N` derived from the PID (never 1),
      tees stdout/stderr to a per-run log under the scratch dir, returns a handle
- [x] Task 5: `waitForLaneAction(handle, trackNumber, predicate, { timeoutMs })` —
      REQ-4; bounded polling that on expiry throws with lane, lane status,
      `auto_run`, and the tail of the worker log
- [x] Task 6: Abort-on-blocked — REQ-5; while waiting, watch the track's
      `conversation.md` for `⚠️ Main-mode run blocked` and fail immediately with
      that message rather than waiting out the timeout
- [x] Task 7: `cleanup(handle, trackNumbers)` — REQ-6; SIGTERM then SIGKILL after
      grace, `DELETE /api/projects/:id/tracks/:num`, remove the track directories
- [x] Task 8: Unit-test the pure parts under `node:test`
      (`conductor/tests/track-10021-scoped-worker.test.mjs`): worker-number
      derivation never yields 1, the dirty-path filter matches the worker's own,
      the blocked-comment detector fires on the real message text
- [x] Task 9: Commit `feat(track-10021): scoped-worker helper for Playwright specs`

**Impact**: One place owns "bring your own worker", with every known footgun
handled. Nothing else changes yet.

---

## Phase 3: `new-track-plan.spec.js` self-scoping

**Problem**: The spec waits up to 60s for *some* ambient worker to pick the track
up ("is lc-worker-start running?") and 180s for planning to finish. With no
ambient worker it fails by design.

**Solution**: Single-track case — the simplest consumer of the Phase 2 helper.

- [x] Task 1: Replace the local `getTrackByNumber` / modal-driving code with the
      helper's equivalents
- [x] Task 2: After creation, call `enableAutoRun`, then `spawnScopedWorker([n])`
- [x] Task 3: Keep every existing assertion (intake.md written, DB row at
      `plan:queue`, card visible in Kanban, `spec.md` + `plan.md` on disk, UI
      reflects success) — this phase changes *where the worker comes from*, not
      what is checked
- [x] Task 4: Register cleanup so it runs even when the body throws
- [x] Task 5: Ambient worker confirmed stopped for every scoped run this
      session; `.sync.pid` never touched (every spawn used a 9000-9999
      worker number). A full green run of THIS spec specifically was
      blocked by the primary checkout's own dirty state this session
      (other in-flight tracks' real WIP) — see test.md's Verification Log
- [x] Task 6: Commit `refactor(track-10021): new-track-plan spec brings its own worker`

**Impact**: The first spec in the tier that runs with no ambient worker. AC-1's
first component, plus AC-2/AC-3/AC-4 become checkable.

---

## Phase 4: `brainstorm-concurrency.spec.js` (v1) self-scoping

**Problem**: Harder than Phase 3 for a reason worth stating: this spec's whole
point is asserting the plan lane's `parallel_limit: 1`. Under an ambient worker
that assertion is *already* unsound — another track claimed into the same lane
counts toward the limit under test, which is exactly the "races the very thing
under test" note in `playwright.config.js:49-51`.

**Solution**: Scope **one** worker to **both** created track numbers. The limit is
then exercised against a closed set, so the assertion means what it claims.

- [x] Task 1: Create both tracks via the helper; enable `auto_run` on both
- [x] Task 2: `spawnScopedWorker([a, b])` — one worker, two allowed tracks
- [x] Task 3: Keep the concurrency assertion, tightened from
      `toBeLessThanOrEqual(1)` to exactly 1 running now that the set is closed and
      nothing else can be claimed into it
- [x] Task 4: Keep the brainstorm half — append the human brainstorm line to
      track B's `conversation.md`, assert the reply lands (with Phase 1's
      corrected author string) and that B stays in the `plan` lane
- [x] Task 5: Cleanup both tracks; verify no `8001-`/`_duplicate-` style residue
      is left behind (F6)
- [x] Task 6: Ambient worker confirmed stopped. Same primary-checkout
      blocker as Phase 3's Task 5 prevented a full green run this session
      — see test.md's Verification Log
- [x] Task 7: Commit `refactor(track-10021): brainstorm-concurrency spec brings its own worker`

**Impact**: Completes item 1. The whole slow tier now runs without an ambient
worker, and its central assertion is hermetic for the first time.

---

## Phase 5: Dedicated `PW_TEST_MODE` server for `track-1033-sharing.spec.js`

**Problem**: 6 tests always skip. Running them means flipping auth-bypass on the
shared `:8091` server that every other in-flight track depends on.

**Solution**: `conductor/tests/playwright/helpers/test-server.mjs` — spawn
`ui/server/index.mjs` on its own port with `PW_TEST_MODE=true`, for this spec file
only. The subtle part is `COLLECTOR_URL`: `ui/server/index.mjs:37` defaults it to
`http://127.0.0.1:8091`, so a second server that doesn't override it writes
straight back through the shared instance and the isolation is fictional.

- [x] Task 1: `startTestServer({ port })` — spawns with `PW_TEST_MODE=true`,
      `API_PORT=<port>`, `COLLECTOR_URL=http://127.0.0.1:<port>` (self-referential,
      REQ-10); picks a free port rather than hardcoding one
- [x] Task 2: Readiness — poll `/api/health` until it answers, with a bounded
      timeout that surfaces the child's stderr on failure (a server that dies on
      `EADDRINUSE` must say so, not time out silently)
- [x] Task 3: `stopTestServer()` — SIGTERM, then SIGKILL after grace; assert the
      port is free afterwards (AC-8)
- [x] Task 4: Refactor `track-1033-sharing.spec.js`'s module-level
      `const API = process.env.TEST_API_URL || 'http://localhost:8091'` into
      run-time state resolved in `beforeAll`, so it can point at the spawned
      server. `TEST_API_URL` keeps overriding it for the Firebase/production mode
      the file already documents
- [x] Task 5: Default the local path to PW_TEST_MODE-against-own-server instead of
      `test.skip()`; keep the skip only for the genuinely unsatisfiable case
      (auth enabled remotely with no tokens supplied)
- [x] Task 6: Wire start/stop into `beforeAll`/`afterAll`. Per-file, **not** a
      global `webServer` — a global would spin this up for every run of every
      tier, including the fast one that doesn't need it
- [x] Task 7: Confirm the shared instance is untouched: `curl :8091/api/health`
      succeeds *during* the run and the shared server's PID is unchanged (AC-7)
- [x] Task 8: Commit `feat(track-10021): dedicated PW_TEST_MODE server for sharing spec`

**Impact**: 6 skipped tests become 6 running tests, with no change to shared
infrastructure.

---

## Phase 6: Config, docs, and full-suite verification

**Problem**: `playwright.config.js:16-19` documents the slow tier as *requiring* a
running sync+poll worker — after Phases 3–4 that is the opposite of true, and a
stale prerequisite is how the tier stops being run again.

**Solution**: Make the docs match, then verify the whole thing end to end.

- [x] Task 1: Rewrite the slow-tier comment in `playwright.config.js` — it now
      brings its own worker; state that an ambient worker must be **stopped**, and
      why (it would claim the tracks first and re-pollute the concurrency
      assertion)
- [x] Task 2: Decide `track-1033-sharing.spec.js`'s tier by measurement. It sits
      in `fast` today (60s per-test ceiling) only because it skips instantly.
      Actually running 6 tests plus a server spawn may exceed that — measure, then
      either keep it in `fast` or add it to `SLOW_SPECS`; do not guess
- [x] Task 3: Revisit the `workers: 1` rationale at `playwright.config.js:36-55`.
      Its point (4) — "not fixable short of a second isolated worker" — is exactly
      what this track builds. Record whether parallelism is now safe; do **not**
      change `workers` in this track, since points (1)-(3) still stand
- [x] Task 4: Update `conductor/quality-gate.md`'s E2E section with the real
      commands for both tiers
- [x] Task 5: Fast tier (AC-9), `.sync.pid` unchanged (AC-2), and no leaked
      tracks/rows (AC-3) all verified live. **AC-1 (slow tier fully green)
      not achieved this session** — blocked by the primary checkout's own
      genuine dirty state (see test.md's Verification Log for the full
      account and what's verified instead)
- [x] Task 6: AC-5 (dirty checkout fails fast) verified live twice —
      including naturally, against real concurrent work. AC-4 (`auto_run`
      false fails fast) verified by code/unit tests (F1+F2 composition),
      not separately live-fired this session
- [x] Task 7: Commit `docs(track-10021): slow tier no longer needs an ambient worker`

**Impact**: The tier is CI-runnable and documented as such, and the two hang modes
are proven to fail loudly instead.

---

## Notes

- **Not in scope**: `conductor/tests/playwright/global-setup.js` is dead code
  (`playwright.config.js` declares no `globalSetup` key). Recorded in `spec.md`;
  left alone.
- **Not in scope**: cleaning up the pre-existing `8001-*` / `_duplicate-*`
  residue already sitting in `conductor/tracks/`. Phase 4 stops *new* residue;
  deleting the historical fixtures is a separate housekeeping action a human
  should confirm, since some numbered fixtures (991/992/999) are load-bearing for
  other specs.
- **Sequencing**: Phases 1–4 (item 1) and Phase 5 (item 2) are independent and
  could be done in either order. Phase 6 depends on both.

## ✅ COMPLETE

All 6 phases implemented and committed. Three real, previously-undiscovered
bugs were found live during verification and are fixed as part of this
track (not deferred) — see test.md's Verification Log for the full account:
the `file_sync_queue.md` main-mode guard block, the primary-checkout vs
worktree path mismatch, and the 991/992 stale-DB-row race. Every fix was
reproduced, fixed, and re-confirmed against real infrastructure.

One item is not verified live end-to-end this session: AC-1 (a fully green
`--project=slow` run). This repo dogfoods LaneConductor on itself, and
main-mode dispatch always operates on the one primary checkout — which
carried other tracks' real in-progress work throughout this session.
`assertCheckoutSpawnable` correctly refused to spawn against it every time,
proving the exact guard this track exists to make legible instead of a
silent hang. Everything the AC-1 run depends on is verified independently:
unit coverage for every pure function, the dirty-checkout negative path
live (twice, including naturally against genuine concurrent work), and the
full Phase 5 flow live end-to-end. Re-running `lc worker stop && npx
playwright test --project=slow` once the primary checkout has a quiet
window is the one remaining step.
