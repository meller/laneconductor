# Tests: Track AM-10089 — Sync worker cwd-normalization lets worktree-run tests overwrite the shared conductor/workflow.json

## Test Commands
```bash
# Run one fixed file (repeat per file listed below)
node --test conductor/tests/<file>.test.mjs

# After each run: confirm no orphaned worker processes were left behind
ps aux | grep laneconductor.sync.mjs | grep -v grep

# After the full fixed suite: confirm the shared config file wasn't touched
git status --porcelain conductor/workflow.json

# Confirm no fixed file still builds an in-repo sandbox path
grep -rn "join(ROOT, '\.test-tmp" conductor/tests/
```

## Test Cases

### Phase 1 — single-sandbox, single-spawn files
- [ ] TC-1.1: `node --test conductor/tests/chat-reply-conversation-md.test.mjs` — all existing assertions pass unchanged.
- [ ] TC-1.2: `node --test conductor/tests/track-10011-gemini-discovery.test.mjs` — passes.
- [ ] TC-1.3: `node --test conductor/tests/track-10020-resumed-session-unanswered-tail.test.mjs` — passes.
- [ ] TC-1.4: `node --test conductor/tests/track-1086-session-resilience-worker.test.mjs` — passes.
- [ ] TC-1.5: `node --test conductor/tests/track-1086-session-worker.test.mjs` — passes.
- [ ] TC-1.6: `node --test conductor/tests/track-1087-non-claude-fallback.test.mjs` — passes.
- [ ] TC-1.7: `node --test conductor/tests/track-1087-worker-chat-dispatch.test.mjs` — passes.
- [ ] TC-1.8: `node --test conductor/tests/track-1111-model-precedence.test.mjs` — passes.
- [ ] TC-1.9: `node --test conductor/tests/track-1113-chat-coordination.test.mjs` — passes.
- [ ] TC-1.10: `node --test conductor/tests/worker-id-watchdog.test.mjs` — passes, AND its new
      `waitForServingRoot()` assertion (REQ-6) confirms the worker's reported serving root
      equals its own sandbox path, not this repo's primary checkout.

### Phase 2 — BASE/LOCAL stands-in-for-primary files
- [ ] TC-2.1: `node --test conductor/tests/track-10017-auto-run-phase7-e2e.test.mjs` — passes; full run, not a smoke check, since this exercises real auto-run transitions.
- [ ] TC-2.2: `node --test conductor/tests/track-10035-direct-merge-e2e.test.mjs` — passes; confirm the direct-merge assertions themselves (not just worker startup) still exercise real git merge behavior against the relocated `LOCAL` sandbox.
- [ ] TC-2.3: `node --test conductor/tests/track-10035-pr-flow-e2e.test.mjs` — passes; same care as TC-2.2 for the PR-flow assertions.

### Phase 3 — multi-sandbox / multi-spawn files
- [ ] TC-3.1: `node --test conductor/tests/track-1085-dispatch-worker.test.mjs` — passes; both spawn sites against the migrated sandbox behave identically to before.
- [ ] TC-3.2: `node --test conductor/tests/track-1091-orphan-worker-reaping.test.mjs` — passes; both independent sandboxes migrated, orphan-reaping assertions unchanged.
- [ ] TC-3.3: `node --test conductor/tests/track-10047-bounded-resume.test.mjs` — passes for all 5 call sites (tc14, tc16, tc17, tc18, tc19) after the shared `startWorker()` helper is migrated once.
- [ ] TC-3.4: `node --test conductor/tests/worker-mode.test.mjs` — passes for all 4 independent `it()` cases.
- [ ] TC-3.5: `node --test conductor/tests/track-1119-phase6-e2e-autorun.test.mjs` — passes; specifically confirm the `projectWorker` (non-manager) path no longer risks a primary-checkout redirect (this was the genuinely vulnerable spawn in this file).

### Phase 4 — bin/lc.mjs-spawning files
- [ ] TC-4.1: `node --test conductor/tests/track-1110-lc-start-lock.test.mjs` — passes; `lc start`/`lc stop` against the migrated sandbox behave identically, AND confirm (via a manual repro or an added assertion) that a `bin/lc.mjs start` invoked from inside a linked worktree with this sandbox no longer resolves `resolvePrimaryRepoRoot()` to the worktree's primary — this file's whole point is being the CLI-spawn counter-example to the `LC_SKIP_CWD_NORMALIZATION` env var, which doesn't gate `bin/lc.mjs`.
- [ ] TC-4.2: `node --test conductor/tests/track-1110-stop-confirms-death.test.mjs` — passes; death-confirmation timing/assertions unchanged.

### Phase 5 — hygiene fixes (manager-only spawns)
- [ ] TC-5.1: `node --test conductor/tests/track-10049-e2e-real-launch.test.mjs` — passes.
- [ ] TC-5.2: `node --test conductor/tests/track-1089-provision-worker-dispatch.test.mjs` — passes.
- [ ] TC-5.3: `node --test conductor/tests/track-1091-manager-worker.test.mjs` — passes.
- [ ] TC-5.4: `node --test conductor/tests/track-1119-wizard-dispatch.test.mjs` — passes.
- [ ] TC-5.5: `node --test conductor/tests/track-AM-1121-marketing-tracks.test.mjs` — passes for both of its manager sandboxes.

### Phase 6 — full-suite / repro verification
- [ ] TC-6.1: Run all 24 fixed files' `node --test` commands back-to-back from
      inside a linked worktree (this track's own worktree qualifies) — confirm
      `git status --porcelain conductor/workflow.json` is clean before and after,
      in both this worktree and the primary checkout (read-only check on the
      primary — do not touch it directly).
- [ ] TC-6.2: `ps aux | grep laneconductor.sync.mjs | grep -v grep` returns
      nothing after the full run (no orphaned worker processes).
- [ ] TC-6.3: `grep -rn "join(ROOT, '\.test-tmp" conductor/tests/` shows no hits
      inside any of the 24 fixed files (hits in `track-1084-worker-identity.test.mjs`
      and `primary-root-normalization.test.mjs` are expected and correct — both
      are out of scope for this track, see spec.md).

## Acceptance Criteria
- [ ] All 24 in-scope test files pass individually and together, with no
      assertion changes beyond sandbox plumbing (REQ-5).
- [ ] REQ-6's regression assertion (TC-1.10) exists and passes.
- [ ] No orphaned worker/CLI processes after any run (TC-6.2).
- [ ] `conductor/workflow.json` byte-identical before/after the full fixed suite
      runs from inside a linked worktree (TC-6.1) — the exact live incident this
      track exists to close.
- [ ] No regressions in related features — the rest of the test suite
      (`node --test conductor/tests/local-fs-e2e.test.mjs`,
      `node --test conductor/tests/local-api-e2e.test.mjs`,
      `node --test conductor/tests/track-1084-worker-identity.test.mjs`, and
      `cd ui && npx vitest run`) still passes unchanged.
