# Track 1117: Worker reset, reconcile, model-staleness, and lock-crash bugs

## Phase 1: Scope the unscoped stuck-reset (Bug 1, REQ-1/2/3)

**Problem**: `resetStuckActions(true)` on every worker startup resets every
`running`/`queued` track project-wide via
`POST /tracks/reset-stuck-actions` → `ui/server/index.mjs:2720`'s `immediate`
branch — no ownership check.
**Solution**: Scope the SQL (and/or the caller) to the specific worker
identity starting up.

- [ ] Task 1: Decide scoping mechanism (Open Question 1) — `claimed_by`
      matching this worker's own identity is the more portable choice (works
      identically in remote-api/multi-machine mode where PID liveness can't
      be checked locally); git-lock PID liveness is a same-machine-only
      cross-check that could supplement it but shouldn't be the only gate.
- [ ] Task 2: Update the SQL in `ui/server/index.mjs`'s
      `/tracks/reset-stuck-actions` `immediate` branch to filter by the
      calling worker's identity (need to confirm what identity the endpoint
      already receives — `req.worker_project_id` plus whatever
      worker-identifying field is available in the request/session).
- [ ] Task 3: Confirm REQ-3's non-regression — a worker that itself crashed
      mid-run and restarts must still release its own stale claims. Test
      this explicitly, not just the "don't touch other workers' tracks"
      case.
- [ ] Task 4: Regression-test the existing (correct) periodic path — the
      non-immediate `resetStuckActions(false)` call (heartbeat-staleness
      based, `lane_action_status = 'running' AND last_heartbeat < NOW() -
      INTERVAL '2 minutes'`) is untouched by this fix; confirm it still
      works and isn't accidentally scoped down too.

**Impact**: A live, still-running track under one worker is never
incorrectly reset just because a sibling worker process restarts.

## Phase 2: Fix the backwards orphan-reconcile mismatch guard (Bug 2, REQ-4/5)

**Problem**: `conductor/laneconductor.sync.mjs:5121`'s guard treats a
worktree lane that legitimately *advanced* past the dispatched action
(the normal shape of a success) the same as a genuine inconsistency, and
skips the artifact copy either way.
**Solution**: Consult `workflow.json`'s transition table to tell "advanced
via a known on_success/on_failure" apart from "genuinely wrong."

- [ ] Task 1: Locate the exact function/call site around line 5121 and read
      its surrounding logic in full (post-1111-merge line numbers — this
      spec was written against the current `main`, re-confirm at
      implementation start in case concurrent work shifted it again).
- [ ] Task 2: Add a helper (or reuse an existing one if `workflow.json`'s
      transition validation already exists elsewhere, e.g. near
      `lane-model-resolver.mjs`) — `isValidForwardTransition(fromAction,
      toLane, workflowConfig)` checking `toLane` against
      `workflowConfig.lanes[fromAction].on_success` /
      `.on_failure`.
- [ ] Task 3: Update the guard: if `isValidForwardTransition` is true, copy
      normally (remove the skip). If false, keep skipping AND surface it
      more visibly than a `console.warn` (e.g. a conversation.md comment,
      matching this project's own "human should see this" convention) —
      REQ-4 says flag it, not silently trust it either.
- [ ] Task 4: Test both branches: a track whose worktree lane matches a
      real `on_success`/`on_failure` target (should copy) vs. one that
      doesn't match any valid transition (should still skip, but now
      visibly flagged).

**Impact**: Directly fixes the exact incident that stranded track 1116's
`implement` result for its full 45-minute run and after.

## Phase 3: Stop static presets from overriding live model discovery (Bug 3, REQ-6/7)

**Problem**: `refreshModels()` (`conductor/laneconductor.sync.mjs:454`)
appends every `PROVIDERS[cli].models` preset not already in the discovered
list — even when discovery succeeded and simply omitted that id on purpose
(model retired/inaccessible).
**Solution**: Only fall back to presets when discovery itself failed.

- [ ] Task 1: Change the merge logic — presets should supplement `[]`/`null`
      discovery results (today's existing failure path), not a real,
      non-empty discovery result. Concretely: `combined = discovered.length
      > 0 ? discovered : presets` as the starting point, rather than always
      unioning both.
- [ ] Task 2: Verify against this session's own reproduction —
      `claude-3-5-haiku` should no longer appear in `available_models` once
      a real `claude models list` run succeeds without it.
- [ ] Task 3: Resolve Open Question 2 (REQ-8) — decide whether a launch-time
      CLI crash (bad `--model`) should route through `workflow.json`'s
      `on_failure` instead of today's same-lane re-queue. Document the
      decision here regardless of which way it goes.
- [ ] Task 4: Decide Open Question 3 (REQ-9, shared/persisted model cache)
      — likely defer as explicitly out of scope for this track (bigger
      change than the other three bugs combined); note the deferral
      explicitly rather than silently dropping it.

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

- [ ] Task 1: Add `onCompromised: (err) => { logger.error(...); /* clean,
      controlled shutdown or bounded retry, not a raw throw */ }` to the
      options passed into `lockfile.lock()` in `acquireWorkerLock`.
- [ ] Task 2: Decide the actual recovery behavior inside that handler —
      options: (a) log and let this process exit intentionally (still
      "goes down," but as a clean, logged event instead of an uncaught
      crash — the in-flight dispatch can then be recovered by Phase 1's
      fixed reset logic on the next worker's startup), or (b) attempt to
      re-acquire the lock a bounded number of times before giving up. Pick
      the simpler one (a) unless there's a clear reason (b) is needed —
      note the reasoning either way.
- [ ] Task 3: Write a test that forces the compromise condition (e.g. an
      external process deletes/touches the lock file while
      `acquireWorkerLock`'s caller holds it) and confirms the process
      logs and survives (or exits cleanly) rather than crashing via
      uncaught exception.
- [ ] Task 4: Scope REQ-12 (auto-restart on unexpected exit) — likely defer
      as a separate follow-up track rather than folding process-supervision
      into this fix; note the decision explicitly.

**Impact**: The most severe of the four bugs — currently any transient
lock-refresh hiccup can take down an entire worker and everything it was
running, with no automatic recovery. This is a real production-reliability
fix, not a cosmetic one.

## Phase 5: Full regression pass

**Problem**: Four changes across `laneconductor.sync.mjs`, `index.mjs`, and
`worker-lock.mjs` — need confidence none of the existing worker/sync test
suites regressed.
**Solution**: Run everything, not just the new tests.

- [ ] Task 1: `node --test conductor/tests/*.test.mjs` — full suite,
      diffed against a pre-change baseline (same stash/pop-diff discipline
      track 1116's own implement run used).
- [ ] Task 2: `cd ui && npx vitest run` — full suite, same baseline-diff
      approach.
- [ ] Task 3: Live-verify Phase 1+2's fix together against a disposable
      fixture track (not a real track) — same caution as track 1114 Phase
      18's own fixture learnings (no `Lane: implement/queue` on the fixture,
      to avoid it getting auto-claimed as real work).
