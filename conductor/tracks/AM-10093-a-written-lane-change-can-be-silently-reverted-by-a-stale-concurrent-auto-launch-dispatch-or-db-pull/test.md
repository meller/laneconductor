# Tests: Track AM-10093 — A Written Lane Change Can Be Silently Reverted

## Test Commands

```bash
# This track's own suites (run from the PRIMARY checkout — see Environment Hazards)
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10093-stale-dispatch-clobber.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10093-stale-db-pull-revert.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10093-exit-guard-anchor.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10093-worker-identity-cap.test.mjs

# Regression suites that must stay green (these encode the guarantees this track builds on)
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10040-lane-regression-guard.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10046-stale-lane-snapshot.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10046-run-marker-defer.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10083-claim-mirror-guard.test.mjs
env -u NODE_TEST_CONTEXT node --test conductor/tests/track-1084-worker-identity.test.mjs

# Full worker suite (compare failure sets against main — see Environment Hazards)
env -u NODE_TEST_CONTEXT node --test conductor/tests/*.test.mjs

# Syntax
find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +
```

## Environment Hazards — read before trusting any result

- **`NODE_TEST_CONTEXT`** must be unset for every `node --test` invocation (documented on track
  1096). Use `env -u NODE_TEST_CONTEXT`.
- **Never run the worker-spawning suites from inside a track worktree** (track 10082). A test
  whose TMP fixture has no `git init` of its own gets silently redirected to register against the
  **real primary checkout and DB**. The signature is every subtest timing out on "worker
  registered"; `grep` the log for `which is not the primary checkout` to confirm. That is not a
  regression in this track's code.
- **Check for leaked worker processes after every full run** (tracks 10073, 10080). Both
  `node --test` and `cd ui && npx vitest run` have leaked live `laneconductor.sync.mjs`
  processes. Before calling anything a leak, `readlink /proc/<pid>/cwd` — one process per project
  is expected and normal; duplicates against the *same* cwd are not.
  ```bash
  ps aux | grep '[l]aneconductor.sync.mjs'
  for p in $(pgrep -f laneconductor.sync.mjs); do echo "$p $(readlink /proc/$p/cwd)"; done
  ```
- **Restart the worker before manual verification.** The live worker holds the old code in
  memory; verifying a fix against a process started before the change is a guaranteed false pass.
- **Judge the full suite by a diff against `main`, not an absolute pass count.** This repo's full
  run has a substantial baseline of environment-contention failures. Check out `main` in a
  disposable worktree, run the identical command, and `comm -23` the sorted failure-name sets.

## Test Cases

### Phase 1 — Reproduction (these must FAIL before their fix lands)

- [ ] TC-1.1: Dispatch snapshot reads `done:queue`; `index.md` is rewritten to `plan:queue`
      inside the pre-spawn window; the claim write lands — expected: `**Lane**` is still `plan`.
      *Fails today: the whole-buffer write reverts it to `done`.*
- [ ] TC-1.2: Same window, but assert on the spawn — expected: no `/laneconductor merge` process
      is spawned; the dispatch is abandoned and logged. *Fails today: merge is spawned.*
- [ ] TC-1.3: Mock collector holds `lane_status: done` with `last_updated` 30 s newer than a file
      freshly written to `plan`; one pull tick runs — expected: the file still reads `plan`.
      *Fails today: the forward write is unguarded.*
- [ ] TC-1.4: Same as TC-1.3 with timestamps inside the 10 s `isConcurrentEdit` grace — expected:
      pull skipped. *Passes today; included to prove the grace window is the only thing working
      and that the fix does not rely on it.*
- [ ] TC-1.5: Exit handler for a run dispatched with `laneStatus: 'done'`, where the on-disk lane
      is `done` **only because this run's own pre-spawn write put it there**, and the lane a human
      wrote was `plan` — expected: the `done` write is blocked. *Fails today: `producedByThisRun`
      evaluates true.*
- [ ] TC-1.6: Identity census — classify a `workers` set containing `1`, `100001`, `100002`,
      `105`, `20007` — expected: exactly one base identity, the rest claim-scoped.

### Phase 2 — Pre-spawn revalidation

- [ ] TC-2.1: `revalidateDispatchSnapshot` with identical snapshot and fresh content — expected:
      `{ stale: false, changed: [] }`.
- [ ] TC-2.2: `**Lane**` differs — expected: `stale: true`, `changed` includes `Lane`.
- [ ] TC-2.3: `**Lane Status**` `queue` → `running` — expected: `stale: true` (another claimant
      won).
- [ ] TC-2.4: `**Auto Run**` flipped `yes` → `no` — expected: `stale: true`.
- [ ] TC-2.5: `**Waiting for reply**` flipped `no` → `yes` — expected: `stale: true`.
- [ ] TC-2.6: Unrelated marker changed (`**Summary**`) — expected: `stale: false`. The gate must
      not defer work for edits that cannot change the dispatch decision.
- [ ] TC-2.7: Abandoned dispatch in API mode — expected: exactly one `PATCH /track/:n/action`
      with `lane_action_status: 'queue'`, to the **primary only**, and no fan-out to non-primary
      collectors.
- [ ] TC-2.8: Abandoned dispatch in `local-fs` mode — expected: the file claim is removed, and
      the next cycle can claim the track again.
- [ ] TC-2.9: Claim write touches only `**Lane Status**` — expected: a byte-diff of `index.md`
      before and after shows exactly that one line changed, with a concurrently-added marker
      preserved.
- [ ] TC-2.10: Happy path unchanged — nothing edits `index.md` during the window; expected: the
      spawn proceeds exactly as before, with the same cmd_type, label and workspace mode.

### Phase 3 — DB→disk pull

- [ ] TC-3.1: mtime advances between the pull decision and the write — expected: the lane write
      is skipped, Progress/Phase/Summary still applied, one `warn` logged.
- [ ] TC-3.2: `compareTimestamps` returns `'equal'` and only `**Lane**` disagrees — expected: the
      file wins, lane not pulled.
- [ ] TC-3.3: A genuine human UI drag (DB strictly and legitimately newer, file untouched since)
      — expected: the pull still applies. This is the regression the fix must not cause.
- [ ] TC-3.4: DB lane is *behind* the file (`done` in file, `plan` in DB) — expected: still
      blocked, by the existing rank guard, unchanged.
- [ ] TC-3.5: `content_summary_mismatch` is the only pull trigger and the file is the fresher
      side — expected: no lane write.

### Phase 4 — Exit-handler anchor

- [ ] TC-4.1: Run marker carries `dispatch_lane: 'done'`, disk reads `plan` — expected: write
      blocked.
- [ ] TC-4.2: Run marker carries `dispatch_lane: 'plan'`, disk reads `plan`, run succeeded —
      expected: normal transition to `plan:success` (per `workflow.json`).
- [ ] TC-4.3: Run marker absent or missing `dispatch_lane` (older code) — expected: today's
      behavior exactly, no crash.
- [ ] TC-4.4: A legitimate backwards transition a run genuinely produced (review `on_failure` →
      `implement:queue`) — expected: still allowed.

### Phase 5 — Worker identity cap

- [ ] TC-5.1: Second base identity starting for a project that already has one live — expected:
      non-zero exit, message naming the existing identity's `worker_number`, pid and cwd.
- [ ] TC-5.2: `LC_ALLOW_DUPLICATE_WORKER=1` — expected: starts, with a warning.
- [ ] TC-5.3: `LC_MAX_BASE_WORKERS_PER_PROJECT=0` — expected: check disabled entirely.
- [ ] TC-5.4: Project with 1 base identity running 3 concurrent lane actions (3 claim-scoped
      rows) — expected: counted as 1, start permitted.
- [ ] TC-5.5: `--manager` — expected: never refused (machine-level singleton, own unique index).
- [ ] TC-5.6: `local-fs` mode — expected: never refused (no collector to ask).
- [ ] TC-5.7: Existing identity's heartbeat is stale — expected: not counted as live.

### Phase 6 — Observability

- [ ] TC-6.1: Each suppression path emits exactly one structured log line carrying the track
      number, the snapshot value and the fresh value.
- [ ] TC-6.2: Repeated suppressions for the same track within the throttle interval — expected:
      one line, not one per cycle.
- [ ] TC-6.3: No suppression path appends to `conversation.md`.

## End-to-End / Real-Product Checks

> Required — the acceptance criteria in `spec.md` are user-observable, and unit tests cannot
> detect a dispatch that still picks the wrong lane action in the live worker.

- [ ] E2E-1: With the worker restarted on this branch's code and actively polling, run
      `lc plan <track>` on a track sitting at `done:queue`. Observe for 60 s — expected: the track
      stays at `**Lane**: plan` in `index.md`, in the DB, and on the Kanban board, and the worker
      log shows a `plan` dispatch (or an abandoned-dispatch line), never `merge`.
- [ ] E2E-2: Same, repeated 5 times in a row — the live incident reproduced on 5+ consecutive
      attempts, so a single clean run is not evidence.
- [ ] E2E-3: Attempt to start a second worker for this project — expected: refused with the
      Phase 5 message.
- [ ] E2E-4: Record the observation for each of the above (worker log excerpt plus the track's
      `**Lane**` value over time). "The code looks correct" is not evidence.

## Acceptance Criteria

- [ ] TC-1.1, TC-1.3 and TC-1.5 fail against `main` and pass on this branch.
- [ ] Every Phase 2–6 test case above passes.
- [ ] The five named regression suites pass unchanged.
- [ ] Full `conductor/tests/*.test.mjs` failure set is a subset of `main`'s, confirmed by diff.
- [ ] E2E-1 through E2E-4 performed against a restarted worker, with recorded observations.
- [ ] No leaked `laneconductor.sync.mjs` processes remain after the suite (verified by cwd, not
      by count).
