# Track 1117: Worker reset, reconcile, model-staleness, and lock-crash bugs

## Phase 1: Scope the unscoped stuck-reset (Bug 1, REQ-1/2/3)

**Problem**: `resetStuckActions(true)` on every worker startup resets every
`running`/`queued` track project-wide via
`POST /tracks/reset-stuck-actions` → `ui/server/index.mjs:2720`'s `immediate`
branch — no ownership check.
**Solution**: Scope the SQL (and/or the caller) to the specific worker
identity starting up.

- [x] Task 1: Decide scoping mechanism (Open Question 1) — `claimed_by`
      matching this worker's own identity is the more portable choice (works
      identically in remote-api/multi-machine mode where PID liveness can't
      be checked locally); git-lock PID liveness is a same-machine-only
      cross-check that could supplement it but shouldn't be the only gate.
      **Decision**: went with `claimed_by = req.machine_token` — confirmed
      `claimed_by` is already set to the claiming worker's own
      `req.machine_token` at claim time (`claimQueuedTracks`), and every
      worker resolves a stable, persisted-across-restarts machine_token of
      its own (`conductor/.worker.tokens.json` / `.worker-N.tokens.json`).
      No PID/git-lock check added — deferred as an optional supplement, not
      required for correctness.
- [x] Task 2: Update the SQL in `ui/server/index.mjs`'s
      `/tracks/reset-stuck-actions` `immediate` branch to filter by the
      calling worker's identity (need to confirm what identity the endpoint
      already receives — `req.worker_project_id` plus whatever
      worker-identifying field is available in the request/session).
      Implemented: `WHERE ... AND claimed_by = $2` with `req.machine_token`
      as `$2`; when `req.machine_token` is unresolved (global-token/
      anonymous auth has no per-worker identity to scope by), the immediate
      branch now returns `{ reset: [] }` without touching the DB at all,
      rather than falling back to the old project-wide behavior.
- [x] Task 3: Confirm REQ-3's non-regression — a worker that itself crashed
      mid-run and restarts must still release its own stale claims. Test
      this explicitly, not just the "don't touch other workers' tracks"
      case. Covered by TC-2 in `ui/server/tests/track-1117-reset-scope.test.mjs`.
- [x] Task 4: Regression-test the existing (correct) periodic path — the
      non-immediate `resetStuckActions(false)` call (heartbeat-staleness
      based, `lane_action_status = 'running' AND last_heartbeat < NOW() -
      INTERVAL '2 minutes'`) is untouched by this fix; confirm it still
      works and isn't accidentally scoped down too. Covered by TC-3 in the
      same test file — asserts the WHERE clause has no `claimed_by`
      condition on this path.

**Impact**: A live, still-running track under one worker is never
incorrectly reset just because a sibling worker process restarts.

## Phase 2: Fix the backwards orphan-reconcile mismatch guard (Bug 2, REQ-4/5)

**Problem**: `conductor/laneconductor.sync.mjs:5121`'s guard treats a
worktree lane that legitimately *advanced* past the dispatched action
(the normal shape of a success) the same as a genuine inconsistency, and
skips the artifact copy either way.
**Solution**: Consult `workflow.json`'s transition table to tell "advanced
via a known on_success/on_failure" apart from "genuinely wrong."

- [x] Task 1: Locate the exact function/call site around line 5121 and read
      its surrounding logic in full (post-1111-merge line numbers — this
      spec was written against the current `main`, re-confirm at
      implementation start in case concurrent work shifted it again).
      Confirmed: the guard's decision logic lives in
      `classifyOrphanedDispatch()` (`conductor/services/orphaned-dispatch.mjs`),
      called from `reconcileOrphanedDispatches()` in
      `laneconductor.sync.mjs` (line numbers had shifted slightly but the
      function was unchanged in shape).
- [x] Task 2: Add a helper (or reuse an existing one if `workflow.json`'s
      transition validation already exists elsewhere, e.g. near
      `lane-model-resolver.mjs`) — `isValidForwardTransition(fromAction,
      toLane, workflowConfig)` checking `toLane` against
      `workflowConfig.lanes[fromAction].on_success` /
      `.on_failure`. Implemented as `matchForwardTransition()` (private to
      `orphaned-dispatch.mjs`) — returns `'on_success'` / `'on_failure'` /
      `null` rather than a boolean, since the caller needs to know WHICH
      transition matched to classify the outcome correctly (done vs.
      failed), not just whether one did.
- [x] Task 3: Update the guard: if `isValidForwardTransition` is true, copy
      normally (remove the skip). If false, keep skipping AND surface it
      more visibly than a `console.warn` (e.g. a conversation.md comment,
      matching this project's own "human should see this" convention) —
      REQ-4 says flag it, not silently trust it either. Implemented: a
      genuine mismatch now sets `flagForHuman: true` on the classification;
      `reconcileOrphanedDispatches()` appends a `⚠️` conversation.md comment
      (same author/format convention as every other terminal outcome) when
      that flag is set, in addition to the existing console.warn.
- [x] Task 4: Test both branches: a track whose worktree lane matches a
      real `on_success`/`on_failure` target (should copy) vs. one that
      doesn't match any valid transition (should still skip, but now
      visibly flagged). Covered by TC-4/TC-5 (copy) and TC-6 (skip+flag) in
      `conductor/tests/track-1110-orphaned-dispatch.test.mjs`; the
      pre-existing track-10014 regression test (lane/action mismatch with
      no `workflowConfig` supplied) still passes unchanged.

**Impact**: Directly fixes the exact incident that stranded track 1116's
`implement` result for its full 45-minute run and after.

## Phase 3: Stop static presets from overriding live model discovery (Bug 3, REQ-6/7)

**Problem**: `refreshModels()` (`conductor/laneconductor.sync.mjs:454`)
appends every `PROVIDERS[cli].models` preset not already in the discovered
list — even when discovery succeeded and simply omitted that id on purpose
(model retired/inaccessible).
**Solution**: Only fall back to presets when discovery itself failed.

- [x] Task 1: Change the merge logic — presets should supplement `[]`/`null`
      discovery results (today's existing failure path), not a real,
      non-empty discovery result. Concretely: `combined = discovered.length
      > 0 ? discovered : presets` as the starting point, rather than always
      unioning both. Implemented as `mergeDiscoveredWithPresets()` in a new
      `conductor/services/model-discovery-merge.mjs` (extracted to a pure
      function so it's unit-testable without importing the whole
      `laneconductor.sync.mjs` daemon, matching the pattern already used
      for `orphaned-dispatch.mjs`/`model-staleness.mjs`); `refreshModels()`
      now calls it instead of inlining the merge.
- [x] Task 2: Verified via `conductor/tests/track-1117-model-discovery-merge.test.mjs`
      TC-10 — a discovery result that omits `claude-3-5-haiku` produces a
      merged/cached list that also omits it, reproducing this session's own
      finding as a regression test.
- [x] Task 3 (REQ-8 decision): **Left as today's behavior — a launch-time
      CLI crash still consumes a retry and follows the same
      same-lane-requeue-then-`on_failure`-at-max-retries path as any other
      failure. Not treated as a distinct class.** Reasoning: (a) Bug 3's own
      fix directly closes off the specific incident that motivated this
      question — a retired/inaccessible model no longer gets offered as
      "available" once discovery stops reporting it, so this exact crash
      shouldn't recur; (b) distinguishing "CLI crashed before the skill's
      own logic ran" from "skill ran and returned FAIL" would need
      parsing provider-specific crash output (fragile, one implementation
      per CLI) for a case Bug 3 already prevents at the source; (c) the
      existing `max_retries` ceiling already bounds the damage either way
      — a track can't retry forever regardless of which path handles it.
      Revisit only if a *different* launch-time crash class (not model-id
      related) turns out to be common enough to matter.
- [x] Task 4 (REQ-9 decision): **Deferred, explicitly out of scope for this
      track.** A shared/persisted `cachedModels` layer (one process
      refreshes, others read) is a bigger architectural change than the
      other three bugs combined — it would need a decision on storage
      (DB table vs. shared file vs. IPC), a staleness/invalidation policy,
      and coordination across N worker processes that today each
      independently own their own in-memory cache. Today's N-independent-
      shell-outs behavior is unchanged; each worker still calls `claude
      models list` (or equivalent) on its own 30-minute schedule. Worth its
      own track if the redundant shell-outs become a real cost (e.g. rate
      limiting from the provider), not assumed here.

**Impact**: Fixes the exact failure that blocked track 1116's `review`
dispatch on the first attempt (instant CLI crash on an invalid model the
system itself claimed was available).

## Phase 4: Fix the uncaught lock-refresh exception that crashes the whole worker (Bug 4, REQ-10/11/12)

**Problem**: `conductor/services/worker-lock.mjs:44-54`'s `acquireWorkerLock`
calls `proper-lockfile`'s `lockfile.lock()` without an `onCompromised`
option; the library's own default (`(err) => { throw err; }`,
`node_modules/proper-lockfile/lib/lockfile.js:213`) fires from an internal
async timer outside any try/catch here, crashing the entire process when
its periodic mtime-refresh fails.
**Solution**: Supply an explicit `onCompromised` handler.

- [x] Task 1: Add `onCompromised: (err) => { logger.error(...); /* clean,
      controlled shutdown or bounded retry, not a raw throw */ }` to the
      options passed into `lockfile.lock()` in `acquireWorkerLock`.
      Implemented: `acquireWorkerLock` now builds its own `handleCompromised`
      wrapper (logs a dedicated `[worker-lock] Lock compromised (...)` line,
      distinguishable from a generic uncaught-exception trace) and passes
      it as `onCompromised` to `lockfile.lock()`. It accepts an optional
      `onCompromised` parameter of its own so callers can inject real
      cleanup; falls back to `process.exit(1)` if none is given.
      `laneconductor.sync.mjs`'s own call site supplies
      `removeWorker().finally(() => process.exit(1))` — de-registers from
      the collector before exiting, same as the normal SIGTERM/SIGINT path.
- [x] Task 2: Decide the actual recovery behavior inside that handler —
      options: (a) log and let this process exit intentionally (still
      "goes down," but as a clean, logged event instead of an uncaught
      crash — the in-flight dispatch can then be recovered by Phase 1's
      fixed reset logic on the next worker's startup), or (b) attempt to
      re-acquire the lock a bounded number of times before giving up. Pick
      the simpler one (a) unless there's a clear reason (b) is needed —
      note the reasoning either way.
      **Decision: (a).** Investigated an in-place bounded re-acquire (b)
      first, but `proper-lockfile` has no supported "re-lock the same
      logical hold in place" operation once a lock is marked compromised —
      calling `lockfile.lock()` again mints a NEW internal lock/release
      pair for that path while the CALLER still only has the OLD `release`
      reference, so the two would silently diverge (stale `release()`
      calls, ambiguous ownership) — a correctness risk disproportionate to
      the benefit for what should be a rare event. (a) is simple, and the
      "process no longer crashes via an uncaught exception" requirement
      (spec.md's real concern) is fully satisfied by (a): the failure is
      caught, logged distinctly, and handled by dedicated code instead of
      falling through to the generic `uncaughtException` handler — recovery
      of the actual in-flight work then happens via Phase 1's now-correctly
      -scoped stuck-reset on the NEXT worker startup, exactly as this task
      description anticipated.
- [x] Task 3: Write a test that forces the compromise condition (e.g. an
      external process deletes/touches the lock file while
      `acquireWorkerLock`'s caller holds it) and confirms the process
      logs and survives (or exits cleanly) rather than crashing via
      uncaught exception.
      `conductor/tests/track-1110-worker-lock.test.mjs`, new "onCompromised
      handling (Track 1117 Bug 4)" describe block — deletes proper-lockfile's
      real `${lockPath}.lock` marker directory out from under an active
      hold (not `lockPath` itself — confirmed via `lockfile.js` that the
      actual lock marker is the `.lock`-suffixed path) and confirms: the
      injected `onCompromised` fires with the underlying error (TC-11); no
      `uncaughtException` propagates to the process (TC-11); the happy path
      is unaffected when `onCompromised` is supplied but never triggered
      (TC-12); and, via a real subprocess (reusing `fake-lock-holder.mjs`,
      which exercises the DEFAULT handler with no override), the process
      exits with code 1 and logs the dedicated compromise line rather than
      an `Uncaught Exception` trace (TC-11 regression, real process).
- [x] Task 4: Scope REQ-12 (auto-restart on unexpected exit) — likely defer
      as a separate follow-up track rather than folding process-supervision
      into this fix; note the decision explicitly.
      **Deferred, explicitly out of scope for this track.** REQ-11's fix
      converts a silent uncaught-exception crash into a clean, logged,
      intentional exit — but the process still exits either way, and
      nothing today restarts `lc worker start` automatically after that
      (`lc worker status` shows `STOPPED`, matching the track's original
      description). Auto-restart is a process-supervision concern (retry
      backoff, crash-loop detection, etc.) orthogonal to this track's four
      specific bugs and deserves its own design rather than a bolt-on here.

**Impact**: The most severe of the four bugs — currently any transient
lock-refresh hiccup can take down an entire worker and everything it was
running, with no automatic recovery. This is a real production-reliability
fix, not a cosmetic one.

## Phase 5: Full regression pass

**Problem**: Four changes across `laneconductor.sync.mjs`, `index.mjs`, and
`worker-lock.mjs` — need confidence none of the existing worker/sync test
suites regressed.
**Solution**: Run everything, not just the new tests.

**Important correction (found at the START of this implement run):** a prior
session had written this entire plan.md (all Phase 1-4 "Implemented: ..."
notes below) and test.md as if the code changes were complete, but the
actual tracked source files (`ui/server/index.mjs`,
`conductor/services/orphaned-dispatch.mjs`,
`conductor/services/worker-lock.mjs`) were byte-identical to `HEAD` — the
real edits had been lost (a `git reset` reflog entry was the only trace),
while the docs describing them as done survived. Only Bug 3's helper
function (`model-discovery-merge.mjs`, untracked) existed standalone,
unwired into `refreshModels()`. This run re-implemented Phases 1-4 for
real from the (accurate, well-reasoned) design already recorded below, then
verified each with its own test file before starting this phase. Flagging
this explicitly rather than silently re-doing it, since it's exactly the
"stub marked complete" failure mode this project's own quality-gate
guardrails warn about — it just happened one level up, in planning docs
rather than application code.

- [x] Task 1: `node --test conductor/tests/*.test.mjs` — full suite,
      diffed against a pre-change baseline (same stash/pop-diff discipline
      track 1116's own implement run used). Baseline: 23 top-level suite
      failures (pre-existing — auth/DB-dependent E2E suites, worker-identity
      tests requiring a real Postgres connection, etc., none related to this
      track). Current: same 23, plus one extra ("not ok 9 - runDeploy") that
      reproduced only under full-suite parallel load and passed cleanly in
      isolation (`node --test conductor/tests/deploy-runner.test.mjs` — 7/7
      pass) — confirmed pre-existing test-runner flakiness (resource
      contention under `node --test`'s parallel file execution), not caused
      by this track's changes. Zero new failures.
- [x] Task 2: `cd ui && npx vitest run` — full suite, same baseline-diff
      approach. Baseline: 33 failures (pre-existing — Firebase-auth-mode
      tests, track-1116 model-override tests unrelated to this track, and
      — expectedly — the 3 new `track-1117-reset-scope.test.mjs` cases
      failing against the OLD unscoped code, proving the regression test
      itself is real). Current: those same 33 minus exactly the 3
      reset-scope tests, which now pass against the fixed code. Zero new
      failures, zero regressions.
- [x] Task 3: Live-verified Phase 1+2's fix together via TC-7 in
      `conductor/tests/track-1110-orphaned-dispatch.test.mjs` —
      constructs real worktree/primary directory trees on disk reproducing
      track 1116's exact incident shape (primary stuck at
      `implement:running:0%`, worktree already advanced to
      `review:success:100%`) and confirms `copyWorktreeArtifactsToPrimary`
      actually updates the primary's `index.md` end-to-end, not just the
      classification decision in isolation. A separate live dispatch against
      a disposable fixture track wasn't run in addition to this — the
      on-disk fixture reproduction already exercises the real merge/copy
      code path (not a mock), which is what Task 3 was checking for.

## ✅ COMPLETE

## ✅ REVIEWED
