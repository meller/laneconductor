# Track AM-10093: A Written Lane Change Can Be Silently Reverted by a Stale Concurrent Auto-Launch Dispatch or DB Pull

Phases are ordered so that every fix lands behind a test that fails first. Phase 1 is
reproduction only — no production code changes — because the problem statement's own diagnosis
(multi-identity accumulation as a major contributing factor) is partly unverified, and Phase 5's
design depends on which population the census actually shows.

---

## Phase 1: Reproduce both revert paths, and census the worker identities

**Problem**: The revert is currently only known from live observation. Nothing in the test suite
fails because of it, so no fix can be shown to have worked.
**Solution**: Two failing regression tests plus one evidence-gathering script.

- [ ] Task 1.1: Write `conductor/tests/track-10093-stale-dispatch-clobber.test.mjs` — drive the
      pre-spawn window directly: snapshot an `index.md` at `done:queue`, rewrite it to
      `plan:queue` mid-window, then let the claim write land. Assert `**Lane**` is still `plan`.
      Must fail before Phase 2.
    - [ ] Use an injectable delay hook inside the pre-spawn window rather than racing on real
          timing — a timing-dependent test that passes by luck is worse than none.
- [ ] Task 1.2: Write `conductor/tests/track-10093-stale-db-pull-revert.test.mjs` against a mock
      collector (`conductor/tests/mock-collector.mjs`): DB row at `done` with `last_updated`
      newer than a file freshly written to `plan`, past the 10 s `isConcurrentEdit` grace. Assert
      the file still reads `plan`. Must fail before Phase 3.
- [ ] Task 1.3: Write `conductor/tests/track-10093-exit-guard-anchor.test.mjs` — a run dispatched
      for lane `done` completing against an on-disk `plan` must not write `done`, **even when the
      on-disk value was put there by this run's own pre-spawn write**. Must fail before Phase 4.
- [ ] Task 1.4: Census script — classify every row in `workers` for this project into base vs
      claim-scoped (`worker_number % CLAIM_WORKER_NUMBER_BASE_MULTIPLIER`, accounting for the
      historical multipliers that produced `105`/`20007`-shaped numbers), cross-referenced against
      live `laneconductor.sync.mjs` processes and their `readlink /proc/<pid>/cwd`. Record the
      result in `conversation.md`.
    - [ ] Explicitly answer: how many **base** identities were genuinely alive and polling? If
          the answer is 1, Phase 5's scope shrinks to prevention-only and the "N independent
          stale pulls" theory is recorded as disproven.

**Impact**: Three red tests and a factual identity census. No behavior change.

---

## Phase 2: Close the pre-spawn dispatch window (REQ-1, REQ-2, REQ-3, REQ-7)

**Problem**: R1 and R2 — the dispatch decision and the claim write both run off a snapshot taken
before several seconds of awaited I/O.
**Solution**: One revalidation gate immediately before `spawnCli`, and a fresh-read claim write.

- [ ] Task 2.1: Extract a pure `revalidateDispatchSnapshot({ snapshot, fresh })` helper into
      `conductor/services/dispatch-revalidation.mjs`, returning
      `{ stale: boolean, changed: string[] }` over `**Lane**`, `**Lane Status**`, `**Auto Run**`,
      `**Waiting for reply**`. Pure module, no I/O — same extraction style as
      `lane-regression-guard.mjs` and `workspace-mode.mjs`.
- [ ] Task 2.2: Call it in `autoLaunchLocalFs` immediately before the `try` block that spawns,
      re-reading `index.md` at that instant. On `stale`, log at `warn` naming the track, the
      snapshot values and the fresh values (REQ-7), then `continue`.
- [ ] Task 2.3: Release claims on the stale path (REQ-2) — `PATCH /track/:n/action` back to
      `lane_action_status: 'queue'` on the **primary only** (never fan out; same reasoning the
      existing claim-guard conflict path documents), and remove the local-fs file claim.
- [ ] Task 2.4: Rewrite the running-claim write to read fresh and patch only `**Lane Status**`
      (REQ-3) — replacing `updateHeader(content, ...)` with a fresh read. Keep the existing
      `waitingForReply` gate exactly as track AM-10046 left it.
- [ ] Task 2.5: Confirm Task 1.1's test now passes, and that no existing dispatch test regressed.

**Impact**: A dispatch decision can no longer act on state older than one file read. The worst
case becomes a one-cycle (5 s) deferral, never a wrong action or a lost write.

---

## Phase 3: Close the DB→disk pull window (REQ-5, REQ-6, REQ-7)

**Problem**: R4 — a stale-but-newer DB row overwrites a fresher file, because a forward lane
write is never blocked and the mtime that justified the pull is never rechecked.
**Solution**: Re-stat before writing, and refuse a lane write when the file is the fresher side.

- [ ] Task 3.1: Thread the `indexMtime` that justified the pull into `updateIndexMDFromDB`, and
      re-`stat` immediately before `writeFileSync`. If the mtime advanced, skip the **lane** write
      and log at `warn` (REQ-5, REQ-7).
    - [ ] Skip only the lane write, not the whole pull — Progress/Phase/Summary/Merge Mode are not
          the transition hazard and suppressing them wholesale would stall legitimate UI sync.
- [ ] Task 3.2: Add the fresher-side rule (REQ-6): when `compareTimestamps` says `'equal'` and
      the only disagreement is `**Lane**`, treat the file as authoritative and skip the lane pull.
      The `'equal'` band is a ±1 ms tolerance, not evidence the DB is right.
- [ ] Task 3.3: Re-examine `shouldPullFromDB`'s `content_summary_mismatch` trigger under the new
      rule and confirm it can no longer, on its own, drag a lane backwards or forwards.
- [ ] Task 3.4: Confirm Task 1.2's test now passes.

**Impact**: The 5 s pull loop stops being an independent source of reverts.

---

## Phase 4: Anchor the exit-handler guard (REQ-4)

**Problem**: R3 — `producedByThisRun: preWriteOnDiskLane === laneStatus` is satisfied by a value
this same run's own pre-spawn write placed on disk, disarming the containment primitive.
**Solution**: Anchor to the lane recorded for this run at dispatch time.

- [ ] Task 4.1: Record `dispatch_lane` in the run marker (`conductor/services/run-marker.mjs`,
      written by `spawnCli`).
- [ ] Task 4.2: In the exit handler, compute `producedByThisRun` as
      *on-disk lane equals the run marker's `dispatch_lane`*, falling back to today's comparison
      when the marker is absent or carries no `dispatch_lane` (a marker written by older code).
- [ ] Task 4.3: Confirm Task 1.3's test now passes, and that the existing
      `track-10040-lane-regression-guard` and `track-10046-stale-lane-snapshot` suites still pass
      unchanged — this must strengthen those guarantees, not alter them.

**Impact**: Defence in depth is restored: even if a future change reopens a pre-spawn window, the
exit handler independently refuses the write.

---

## Phase 5: Bound worker-identity accumulation (REQ-8, REQ-9)

**Scope is set by Phase 1 Task 1.4's census** — do not start this phase before reading it.

**Problem**: Nothing prevents N base identities from registering and polling one project.
**Solution**: Prevent accumulation at start time; count only base identities.

- [ ] Task 5.1: Add `classifyWorkerIdentity(workerNumber)` to
      `conductor/services/orphan-worker-detection.mjs` (or a sibling module) returning
      `'base' | 'claim-scoped'`, handling the historical multipliers found in Task 1.4 (REQ-9).
- [ ] Task 5.2: At startup, after `acquireWorkerLock` succeeds and before entering the poll loop,
      query `GET /api/workers`, count live base identities for this `(project_id, hostname)`, and
      apply `LC_MAX_BASE_WORKERS_PER_PROJECT` (default 1). Warn always; refuse and exit non-zero
      above the cap unless `LC_ALLOW_DUPLICATE_WORKER` is set (REQ-8).
    - [ ] Never refuse in `local-fs` mode (no collector to ask) and never for `--manager` (a
          machine-level singleton with its own partial unique index).
- [ ] Task 5.3: Make `lc worker start` surface the refusal as an actionable message naming the
      existing identity, its pid and its cwd — not a bare non-zero exit.
- [ ] Task 5.4: Tests — cap enforced, override honoured, claim-scoped rows not counted, manager
      and local-fs exempt.

**Impact**: The accumulation that multiplied every window above cannot build up silently across a
long session of restarts. This is the marketplace/managed-app hardening the problem statement
calls for: a customer instance restarted repeatedly during upgrades stops compounding the fault.

---

## Phase 6: Observability for suppressed writes (REQ-7)

**Problem**: Every revert in the live incident was invisible — no error, no log line, just a card
that moved. The fixes above must not be invisible in the same way when they fire.
**Solution**: Structured, greppable evidence for every suppression, and a UI signal for
duplicates.

- [ ] Task 6.1: Ensure each suppression path logs once via the shared `logger` with a stable
      component tag and the track number, snapshot value and fresh value. Deliberately **not** a
      `conversation.md` comment — per track 10040, a stale process commenting each cycle is its
      own failure mode.
- [ ] Task 6.2: Throttle repeated suppressions for the same track so a persistently-contended
      track cannot flood the log (same pattern as `LC_COLLECTOR_FAILURE_LOG_INTERVAL_MS`).
- [ ] Task 6.3: Surface a duplicate-base-identity count for a project in the Workers view, so the
      condition is visible before it causes a revert rather than after.

**Impact**: The next occurrence of anything in this family is diagnosable from the log alone,
instead of requiring live `ps aux` archaeology.

---

## Notes for the implementer

- **Restart the worker before believing any manual verification.** The running worker holds the
  old code in memory; a fix on disk changes nothing until restart. This repo has produced several
  false passes this way (`conductor/quality-gate.md`).
- **Phase 1 before everything.** If Task 1.1's test does not fail against current `main`, the
  mechanism in `spec.md` is wrong and the plan must be revised before any fix is written.
- **Do not weaken `lane-regression-guard.mjs`.** Phases 2–4 narrow the windows *feeding* it; the
  guard's own semantics stay as track 10040 and AM-10046 left them.
