# Tests: Track 1117 — Worker reset, reconcile, model-staleness, and lock-crash bugs

## Test Commands
```bash
# Full worker test suite
node --test conductor/tests/*.test.mjs

# Full UI test suite
cd ui && npx vitest run

# Baseline-diff discipline (same pattern track 1116's implement run used)
git stash && node --test conductor/tests/*.test.mjs 2>&1 | grep "^not ok" | sort > /tmp/baseline-failures.txt
git stash pop
node --test conductor/tests/*.test.mjs 2>&1 | grep "^not ok" | sort > /tmp/current-failures.txt
diff /tmp/baseline-failures.txt /tmp/current-failures.txt
```

## Test Cases

### Feature: Scoped stuck-reset (Bug 1)
- [x] TC-1: A track claimed by worker A (still alive, recent heartbeat)
      is NOT reset when worker B starts up with `immediate=true`.
      (`ui/server/tests/track-1117-reset-scope.test.mjs`)
- [x] TC-2: A track claimed by worker A is reset when worker A ITSELF
      restarts with `immediate=true` (no regression to the legitimate
      "I own no running tracks" case).
      (`ui/server/tests/track-1117-reset-scope.test.mjs`)
- [x] TC-3: The non-immediate, heartbeat-staleness-based reset path
      (`last_heartbeat < NOW() - INTERVAL '2 minutes'`) is unaffected by
      this change — still resets a genuinely stale track regardless of
      which worker claimed it.
      (`ui/server/tests/track-1117-reset-scope.test.mjs`)

### Feature: Forward-transition-aware orphan-reconcile guard (Bug 2)
- [x] TC-4: A worktree whose lane is a valid `on_success` target of the
      dispatched action (e.g. dispatched `implement`, worktree now shows
      `review` per `workflow.json`'s `implement.on_success`) has its
      artifacts copied to the primary checkout — no skip.
      (`conductor/tests/track-1110-orphaned-dispatch.test.mjs`)
- [x] TC-5: A worktree whose lane is a valid `on_failure` target is also
      copied (success isn't the only legitimate forward transition).
      (`conductor/tests/track-1110-orphaned-dispatch.test.mjs`)
- [x] TC-6: A worktree whose lane matches NEITHER `on_success` nor
      `on_failure` for the dispatched action is still skipped — but now
      visibly flagged (conversation.md comment or equivalent), not just a
      console warning.
      (`conductor/tests/track-1110-orphaned-dispatch.test.mjs`)
- [x] TC-7 (regression): reproduce track 1116's exact original incident as
      a fixture — dispatch `implement`, worktree ends at `review` (matches
      `on_success`) — confirm the primary checkout now auto-updates without
      manual reconciliation.
      (`conductor/tests/track-1110-orphaned-dispatch.test.mjs`)

### Feature: Live discovery not overridden by static presets (Bug 3)
- [x] TC-8: `refreshModels()` with a successful, non-empty discovery result
      for a provider does NOT append any static preset id absent from that
      result.
      (`conductor/tests/track-1117-model-discovery-merge.test.mjs`)
- [x] TC-9: `refreshModels()` with a failed/empty discovery result for a
      provider DOES fall back to static presets (existing behavior,
      preserved).
      (`conductor/tests/track-1117-model-discovery-merge.test.mjs`)
- [x] TC-10: Reproduce the session's exact finding as a regression test —
      mock discovery returning a Claude model list without
      `claude-3-5-haiku`; confirm `cachedModels.claude` also excludes it.
      (`conductor/tests/track-1117-model-discovery-merge.test.mjs`)

### Feature: Lock-refresh failure no longer crashes the worker (Bug 4)
- [x] TC-11: Force a compromised lock (external process deletes or
      touches the lock file's mtime while `acquireWorkerLock`'s caller
      holds it) — confirm the process logs the failure and exits
      cleanly/recovers, rather than an uncaught exception propagating to
      the top level.
      (`conductor/tests/track-1110-worker-lock.test.mjs` — "onCompromised
      handling (Track 1117 Bug 4)" describe block, including a real
      subprocess regression confirming exit code 1 with the dedicated log
      line, not an `Uncaught Exception` trace)
- [x] TC-12: Normal lock acquisition/release (no compromise) is completely
      unaffected — regression check that the `onCompromised` addition
      doesn't change the happy path.
      (same file)

## Acceptance Criteria
- [x] All test cases above pass. (12/12 in
      `track-1110-orphaned-dispatch.test.mjs`, 7/7 in
      `track-1110-worker-lock.test.mjs`, 6/6 in
      `track-1117-model-discovery-merge.test.mjs`, 6/6 in
      `track-1117-reset-scope.test.mjs`.)
- [x] Full `conductor/tests/*` and `ui` vitest suites show zero NEW
      failures vs. a pre-change baseline (documented diff, not just "tests
      pass"). `node --test`: baseline 23 failing suites, current 23 + one
      confirmed-flaky (`runDeploy`, passes in isolation) — zero attributable
      to this track. `vitest`: baseline 33 failing tests (incl. the 3
      reset-scope tests failing against the pre-fix code), current 33 minus
      exactly those 3, now passing. See plan.md Phase 5 for the full
      breakdown.
- [x] TC-7's fixture reproduction of track 1116's original incident
      demonstrates the fix working end-to-end, not just in isolated units —
      builds real primary/worktree directory trees and confirms
      `copyWorktreeArtifactsToPrimary` actually rewrites the primary's
      `index.md`, not just that `classifyOrphanedDispatch` returns the right
      shape.
