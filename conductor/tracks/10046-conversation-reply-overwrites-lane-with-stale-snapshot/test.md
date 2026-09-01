# Tests: Track AM-10046 — Conversation Reply Overwrites Lane With Stale Snapshot

## Test Commands

```bash
# This track's own regression suites (Phases 1-5)
node --test conductor/tests/track-10046-stale-lane-snapshot.test.mjs
node --test conductor/tests/track-10046-run-marker-defer.test.mjs

# Already-landed half of Finding 2 (must stay green)
node --test conductor/tests/track-10046-waiting-for-reply-conflation.test.mjs

# The guard this track hardens in Phase 5
node --test conductor/tests/track-10040-lane-regression-guard.test.mjs

# Worker E2E — dispatch/auto-launch regressions
node --test conductor/tests/local-fs-e2e.test.mjs
node --test conductor/tests/auto-launch.test.mjs   # note: this file is a Vitest
                                                    # suite misfiled among node:test
                                                    # files — fails under `node --test`
                                                    # even on unmodified main; run it
                                                    # via `cd ui && npm test` instead
```

## Test Cases

All cases below are implemented and green as of Phase 5, except where noted.

### `track-10046-stale-lane-snapshot.test.mjs` (Phases 1, 2, 4, 5 — pure/source-pinned)

- [x] **TC-1** — a forward write over a fresher on-disk lane, not produced by this run, is
      blocked (asserted `shouldBlockLaneWrite(..., requireProducedForAnyChange: true)`; the
      real exit-handler call site always sets this flag). Fixed in Phase 5.
- [x] **TC-2** — the exit handler consults `getConversationRunWriteScope` before writing
      Lane/Lane Status (source-pinned). Fixed in Phase 2.
- [x] **TC-2a** — `getConversationRunWriteScope` denies Lane/Lane Status for every claimable
      lane when `isConversationRun`.
- [x] **TC-2b** — `CONVERSATION_REPLY_ACTION` is not a lane name.
- [x] **TC-2c** — `**Last Run**`/`last_run.log` writes are not gated behind write-scope
      narrowing (unrelated bookkeeping must survive Phase 2's fix).
- [x] **TC-3** — non-regression: a backward write not produced by this run stays blocked
      (already correct pre-track, from track 10040).
- [x] **TC-4** — the reply `customPrompt` no longer instructs a pulse to the stale
      `lane_status` dispatch-time snapshot. Fixed in Phase 2.
- [x] **TC-5** — inside the `waitingForReply` branch specifically, `cmd_type` is never
      reassigned to `lane_status` or hardcoded to a lane name (scoped to that branch's own
      source range — the LEGITIMATE default `let cmd_type = lane_status;` a few lines above,
      for a normal non-reply dispatch, must not false-positive this check). Fixed in Phase 4.
- [x] **TC-9** — a conversation-reply run bypasses `resolveWorkspaceMode` entirely
      (`isConversationRun ? null : resolveWorkspaceMode(...)`), so it can never resolve to
      `'main'` via a stale `laneStatus` and take the global main-mode lock. Sanity-checks that
      `resolveWorkspaceMode` really would force `'main'` for `laneStatus` `plan`/`done` if
      called normally, proving the bypass isn't moot. Fixed in Phase 4.
- [x] **TC-10** — a pre-spawn block (`handlePreSpawnBlock`) never sets `**Waiting for
      reply**` and its comment text never reads like "needs your reply" (it reads as
      "blocked... will retry" / "Permanently blocked... needs human attention"). Satisfied by
      construction once Phase 4's Tasks 1-2 land — no code change needed, verified only.
- [x] **TC-12** — every real `on_success`/`on_failure` transition declared in this project's
      own `conductor/workflow.json` passes the guard when `producedByThisRun` (with
      `requireProducedForAnyChange: true`, matching how the exit handler now always calls it) —
      the normal, uncontended case for every real dispatch. Non-regression for Phase 5's
      guard change.
- [x] **TC-13** — the two audited snapshot-writer sites (max-retries failure write,
      supervised-implement "done" transition) route through `applyGuardedLaneWrite` with a
      fresh `readIfExists(indexPath)` read, not a raw regex patch of loop-scoped `content`
      (source-pinned). Fixed in Phase 5.

### `track-10046-run-marker-defer.test.mjs` (Phases 3, 4 — real end-to-end, via the isolated-worker helper)

- [x] **TC-6/TC-7** — a `waiting_for_reply` dispatch defers while
      `conductor/.runs/<track>.json` shows a live process for that track (a real long-sleeping
      child this test controls); the mock CLI is never invoked while the marker is live. Once
      the marker clears, the reply dispatches on the next auto-launch cycle and the mock CLI
      actually runs. Fixed in Phase 3. (~10.5s real-worker run.)
- [x] **TC-8** — a track sitting in `done` with a genuine unanswered human comment dispatches
      with `'conversation-reply'` in the mock CLI's recorded argv, never `'done'` — proving a
      reply on a `done`-lane track can never look like (or behave like) a merge dispatch under
      the `local-fs-answer` label. Fixed in Phase 4. (~5.5s real-worker run.)

### Guard module changes (`lane-regression-guard.mjs`)

- [x] `requireProducedForAnyChange` (opt-in, default `false`) closes the forward direction
      ONLY for callers that set it — the exit handler's own call site now always does. The
      DB→disk pull site is deliberately left at the default, since its `producedByThisRun:
      false` is a PERMANENT "purely observational" flag (not per-run-computed), and closing
      forward unconditionally there would have blocked legitimate forward UI-drag pulls.
- [x] `rank()` now normalizes through `LaneAliases` (`in-progress`→`implement`,
      `planning`→`plan`, etc.) before ranking — found necessary while wiring Phase 5's own new
      call sites through this module for the first time, when it regressed a previously-passing
      e2e test against a legacy-lane-named fixture. Fixing the shared primitive incidentally
      also fixed two INDEPENDENTLY PRE-EXISTING `local-fs-e2e.test.mjs` failures
      (`on_success: in-progress → review`, `full pipeline`) that predated this track — confirmed
      via `git stash` comparison against unmodified `main` during Phase 2, still present through
      Phase 4, gone after this Phase 5 fix. Not originally in scope; kept because it was directly
      required to avoid introducing a regression of my own, and the fix is a small, well-justified
      change to a primitive I was already modifying for REQ-9.

## Verification beyond unit tests

Per `conductor/quality-gate.md`'s real-product check — unit tests alone can't prove the live
race is gone:

- [x] Every phase's commit ran the full regression suite (this track's own tests, the pre-existing
      guard/conflation suites, and `local-fs-e2e.test.mjs`) against the real worker process — not
      just the pure-logic tests — before committing. No `lc worker restart` was needed since no
      long-running worker instance was serving requests during this implementation session (the
      changes were verified via test-owned, short-lived worker spawns instead, per
      `startIsolatedWorker`).
- [ ] Not yet performed: driving the EXACT original 2026-08-31 incident shape (a lane-action
      dispatch and a conversation-reply resume racing on the same real production track, live)
      end-to-end against this repo's own running worker, with the resulting `index.md` git history
      inspected for a monotonic (non-flapping) transition. The e2e tests above reproduce the
      mechanism deterministically without wall-clock racing; a live dogfooding observation window
      is the remaining, weaker form of evidence and is deferred to the `review`/`quality-gate`
      lanes, which run against this project's actual live worker.

## Acceptance Criteria

- [x] AC-1 — TC-1 (forward clobber blocked) + TC-6/TC-7 (structurally prevented — a reply can no
      longer run concurrently with a lane action on the same track at all).
- [x] AC-2 — TC-3 (non-regression, backward already blocked) + the same structural prevention as
      AC-1.
- [x] AC-3 — TC-2/TC-2a (Lane Status never written by a conversation run, so a concurrent
      `running` status is never clobbered).
- [x] AC-4 — TC-8 (done-lane reply never spawns merge under `local-fs-answer`).
- [x] AC-5 — TC-9 (never resolves to `workspace: main`, never takes the global main-mode lock).
- [x] AC-6 — TC-6/TC-7 (deferred while a run marker is live; dispatched once it clears).
- [x] AC-7 — TC-10 (blocked-retry vs needs-reply already distinct; verified, not implemented).
- [x] AC-8 — TC-2's 3b block (unchanged) + TC-2a's contract test.
- [x] All unit tests pass — `track-10046-stale-lane-snapshot` (12/12),
      `track-10046-run-marker-defer` (2/2), `track-10046-waiting-for-reply-conflation` (15/15,
      unaffected), `track-10040-lane-regression-guard` (9/9, unaffected).
- [x] No regressions in related features — `local-fs-e2e.test.mjs` (7/7 — including 2 tests that
      were independently pre-existing-broken before this track and are now fixed as a side effect
      of the Phase 5 `LaneAliases` fix).
