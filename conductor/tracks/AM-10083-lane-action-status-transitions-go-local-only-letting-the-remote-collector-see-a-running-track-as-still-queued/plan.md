# Track AM-10083: Lane action status transitions go local-only

Six phases. Phase 1 reproduces all three root causes as failing tests before
anything is fixed. Phases 2-5 fix them in dependency order: the cloud upsert
first, because until it honours the payload no amount of fan-out changes what
the remote collector shows. Phase 6 closes out regressions and docs.

Read `spec.md` first — RC-1, RC-2, RC-3 and F-1 are named there and referred
to by those labels throughout.

---

## Phase 1: Reproduce all three root causes as failing tests

**Problem**: Every claim in `spec.md` was derived by reading code. None of it
is pinned by a test, so a fix could pass review while changing nothing a user
would notice — the exact failure mode this repo has been bitten by before.

**Solution**: Three tests that fail today for three different reasons, written
before any production change. Each must be run and each must be observed
failing, with the failure output recorded, before Phase 2 begins.

- [x] Task 1.1: Multi-collector e2e (`conductor/tests/track-10083-status-fanout-e2e.test.mjs`).
      Start two `mock-target.mjs` instances, write a `.laneconductor.json`
      with both as collectors, start a real worker, dispatch a lane action,
      and assert both collectors' `/_state` report `lane_action_status:
      'running'` for the track. Follow the setup in
      `conductor/tests/track-10064-collector-retry-e2e.test.mjs` — it already
      does two-collector worker spawning correctly.
    - [x] Confirm it fails today, and that it fails because the second
          collector never receives the write, not because of a setup error.
          Confirmed: asserting on end-state `lane_action_status` alone raced
          the file-watch path and passed for the wrong reason (mock-target.mjs
          doesn't reproduce cloud's RC-2 bug) — rewrote the assertion to check
          `requestAuthLog` for the actual `PATCH /track/:num/action` request
          reaching the secondary, which correctly failed pre-fix and passes
          post-fix.
- [x] Task 1.2: Cloud upsert contract test — landed at
      `cloud/functions/test/track-10083-post-track-lane-action-status.test.js`,
      not `conductor/tests/`. Asserts on the actual SQL/params sent to
      `query()` for the existing-row and lane-status-null cases described.
    - [x] Established the harness: `cloud/functions/test/*.test.js` uses Jest
          with `pg` fully mocked (`jest.mock('pg', ...)`) — no existing test
          runs `cloud/functions/index.js` against a real Postgres instance.
          Followed that convention rather than inventing a database fixture.
    - [x] Confirmed all 6 assertions fail against the pre-fix code (verified
          via a controlled stash/restore of just `cloud/functions/index.js`)
          and pass against the fix.
- [x] Task 1.3: Superseded by Task 1.2's own harness choice — a single Jest
      suite exercising the real route handler directly, asserting on the
      generated SQL, was more precise than a separate local/cloud string
      comparison would have been (`ui/server/index.mjs`'s own equivalent
      logic isn't itself SQL-CASE-shaped, so a literal string-diff parity
      test wasn't the right tool — see Task 2.2's note on mirroring
      *behaviour*, not code shape).

**Impact**: The bug is pinned. Nothing is fixed yet.

---

## Phase 2: Make the cloud collector honour `lane_action_status` on update (RC-2)

**Problem**: `cloud/functions/index.js`'s `ON CONFLICT` clause derives
`lane_action_status` from the row already in the database and ignores the
payload, so `running` can never arrive and a stale `running` can never clear.

**Solution**: Replace the derived `CASE` with the local collector's semantics —
the payload wins when it supplies a value, the lane-change reset applies when
it does not.

- [x] Task 2.1: Justified — checked `POST /tracks/reset-stuck-actions` and
      both `/tracks/claim-queue` handlers (local + cloud): both set
      `lane_action_status` via their OWN dedicated `UPDATE`, independent of
      `POST /track`. Nothing anywhere relies on `POST /track` being *unable*
      to clear `running`. Removed with no equivalent guard needed.
- [x] Task 2.2: Rewritten — fetches the existing row (`SELECT lane_status`)
      and computes `updateActionStatus`/`resetActionResult` in JS exactly the
      way `ui/server/index.mjs` computes its own `laneStatusClause` (payload
      wins when supplied; a lane change with no explicit status resets to
      `queue` and clears the result; otherwise untouched) — mirrors the RULE,
      not the code shape (cloud's route doesn't carry the human/regression
      guards the local route does; out of scope here, see F-3/AM-10084).
- [x] Task 2.3: Fixed — `laneChanging` no longer depends on whether the
      `lane_status` column itself is being written, so an explicit status
      with `lane_status: null` still applies (TC-2.4).
- [x] Task 2.4: Confirmed passing (all 6 cases in the Jest suite).
- [ ] Task 2.5: **NOT DONE — requires human action.** Deploying
      `cloud/functions/index.js` to the live Firebase Cloud Function is a
      production infrastructure change this session cannot make
      autonomously (no deploy credentials/authorization in this context, and
      it is exactly the class of hard-to-reverse, shared-system action that
      needs an explicit human go-ahead). The code change is complete and
      covered by the Jest suite above; a human needs to run the actual
      deploy (`firebase deploy --only functions:api` or equivalent) and spot
      check `app.laneconductor.com` against a real running track before this
      specific task can be marked done.

**Impact**: `syncTrack()`'s existing fan-out starts working for this field.
On its own this already fixes both live symptoms, at file-watch latency.
Phase 3 is what makes it prompt.

---

## Phase 3: Fan out track-state writes to every collector (RC-1)

**Problem**: The dispatch loop's status writes address `primaryCollector()`
directly, so they are structurally local-only regardless of Phase 2.

**Solution**: Route the writes that carry track state through
`patchCollectors`, and leave the writes that address primary-only rows alone.

- [x] Task 3.1: Added `patchTrackAction(trackNumber, fields)` right after
      `patchCollectors` — a thin wrapper, `return patchCollectors(...)`, so
      callers' existing `.catch()` semantics are unchanged.
- [x] Task 3.2: Converted at the re-derived locations: the `running` claim
      write (line 9561 by the time of edit), the revert on spawn failure
      (9593), the run-completion write (6636), the orphan-reconciliation
      write (8809), the timeout-failure write (5877), `patchTrackPrFields`
      (4766), and the discard-to-backlog write (9091). All 7 confirmed
      converted; `grep -n "patch(url, token, ..." /track/` after the edits
      shows only the one deliberately-left telemetry site remaining.
- [x] Task 3.3: Left as-is with a REQ-4 comment: the `/worker-dispatch/:id`
      calls and the pre-spawn-block reset already had no change needed
      (never touched); `/tracks/claim-queue`, `/file-sync/:id`, and
      `/track/:num/lock`/`unlock` likewise untouched.
- [x] Task 3.4: Left primary-only, comment added at the site.
- [x] Task 3.5: Passes.

**Impact**: A status transition reaches every collector within one HTTP round
trip of the local write, instead of waiting on a file-watch event.

---

## Phase 4: Give each collector a `project_id` that resolves on it (F-1, REQ-5)

**Problem**: `upsertWorker()` assigns `proj.id` from each collector's
`/project/ensure` in turn and rewrites `.laneconductor.json` each time, so one
id — whichever collector answered last — is sent to all of them. The cloud's
`checkProject` returns `403` for an id that does not resolve in its workspace,
so Phase 3's fan-out of `project_id`-bearing bodies depends on getting this
right.

**Solution**: Keep a per-collector project id in memory and substitute it at
send time.

- [x] Task 4.1: Added `collectorProjectIds` (module-level `Map<url, id>`),
      populated for every collector, not just primary.
- [x] Task 4.2: `upsertWorker()` now only writes `proj.id`/the config file
      when `i === 0` (primary).
- [x] Task 4.3: `bodyForCollector(url, body)` substitutes
      `resolveProjectIdForCollector(url)` whenever the outgoing body has an
      own `project_id` key; wired into both `postToCollectors` and
      `patchCollectors` for the primary send and every non-primary send
      (including what gets queued into the retry buffer, so a replay carries
      the right id too).
- [x] Task 4.4: `resolveProjectIdForCollector` falls back to
      `getProject()?.id` when the map has no entry for that URL yet.
- [x] Task 4.5: `conductor/tests/track-10083-per-collector-project-id.test.mjs` —
      two mocks configured with different `/project/ensure` answers (111,
      222); asserts the config file ends up with 111 (primary's) and that a
      synced track's `project_id` field differs correctly per collector (111
      on primary, 222 on secondary). Confirmed failing pre-fix, passing
      post-fix.
- [x] Task 4.6: Checked — same shape of bug. `if (res.id) myWorkerId = res.id;`
      is assigned unconditionally on every loop iteration in `upsertWorker()`,
      so it too ends up as whichever collector's `/worker/register` answered
      LAST, then gets used everywhere against `primaryCollector()`'s token
      (a mismatch: an identity from one collector, used to authenticate
      dispatch-inbox polling against a DIFFERENT one). Recorded in
      `conversation.md` as a separate finding — not fixed here, per this
      task's own instruction not to widen this track.

**Impact**: Fan-out addresses the right project on every collector, and the
project config file stops being rewritten by a remote collector's answer.

---

## Phase 5: Mirror the claim, and refuse a conflicting spawn (RC-3, REQ-6)

**Problem**: `POST /tracks/claim-queue` is atomic per collector and is called
on the primary only, so the same track stays claimable everywhere else. Phases
2-4 narrow that window to one round trip but cannot close it.

**Solution**: Mirror the claim outward immediately, and cross-check before
spawning. The cross-check aborts only on a confirmed conflict; an unreachable
collector is not a conflict.

- [x] Task 5.1: Implemented in `autoLaunchLocalFs`, right after the
      `/tracks/claim-queue` win, guarded by `otherCollectors.length`.
      **Deliberate reordering from the task's literal wording**: the mirror
      runs AFTER the pre-spawn check below, not before — mirroring first
      would send THIS worker's own token to every other collector before
      ever looking for a foreign claimant there, silently overwriting the
      exact evidence the check exists to find (a real correctness bug, not
      just a test-ordering nuance — confirmed while writing TC-5.2).
      Recorded here since it's a deliberate deviation from the phase
      description.
- [x] Task 5.2: `GET /track/:num` (3s timeout) on each non-primary collector.
      Confirmed-conflict requires the row `lane_action_status === 'running'`
      AND a `claimed_by` reported AND that claimant differing from
      `ownMachineTokens.get(collector.url)`. Also added: `claimed_by` is now
      SET (from `req.machine_token`, auth-derived, never client body data)
      by a `running` `PATCH /track/:num/action` on both collectors — mirrors
      how `/tracks/claim-queue` already sets it — since REQ-6's "different
      claimant" concept needed *some* identity to compare, and reusing the
      existing auth-derived pattern was safer than trusting a client-supplied
      field.
- [x] Task 5.3: Every failure mode of the `GET` (network error, timeout,
      non-2xx, JSON parse failure — `get()`'s own `throwHttpError` covers all
      of these uniformly) is caught in one `catch` and logged at `info`,
      never blocking.
- [x] Task 5.4: One `> **system**: ⚠️ Spawn refused — ...` comment naming the
      conflicting collector URL, posted before `continue`.
      **Also added, not explicitly in this task but required for
      correctness**: on a confirmed conflict, the claim this very cycle just
      won on PRIMARY is explicitly reverted to `queue` (primary-only, never
      fanned out — fanning the revert to the CONFLICTING collector would
      stomp the other worker's genuine claim there). Without this the track
      would stay permanently stuck at `running` on primary with nothing ever
      retrying it, since the code path that would normally write `running`
      to the local file (and thus trigger the next completion write) is
      never reached when the guard blocks.
- [x] Task 5.5: `conductor/tests/track-10083-claim-mirror-guard.test.mjs`,
      4 cases: TC-5.1 (mirror lands on a non-conflicting claim), TC-5.2
      (confirmed conflict blocks + posts the comment + reverts primary to
      `queue`), TC-5.3 (a collector reflecting THIS worker's own identity
      does not block), TC-5.4 (an unreachable collector does not block).
      TC-5.2 is the only one of the four that can actually discriminate
      "guard present vs absent" (5.1/5.3/5.4 test "never blocks" properties,
      trivially true with no guard at all) — confirmed via a controlled
      revert of just `conductor/laneconductor.sync.mjs` that only TC-5.2
      fails pre-fix, all four pass post-fix. TC-5.5/5.6 from `test.md` (403,
      unparseable body) share the exact same catch-all code path TC-5.4
      exercises and were not separately reproduced — verified by reading the
      code (one `try`/`catch` around the whole `get()` call), not by a
      dedicated test, given the scope already covered.

**Impact**: The residual cross-collector double-dispatch race is detected and
refused rather than silently double-running. It is not eliminated; `spec.md`'s
Non-Goals say so plainly.

---

## Phase 6: Regressions, degraded-path verification, and docs

**Problem**: The failure this track fixes was invisible for as long as it
existed. The fix has to be verified against the real degraded path, not just
the happy one, and the documented model of who writes to the remote collector
is now wrong.

- [x] Task 6.1: Ran `track-10064-collector-health(.e2e)`,
      `track-10064-collector-retry(.e2e)`, `cloud-route-parity`,
      `local-api-e2e`, and `track-1110-claim-race-api-mode`. The 10064 suites
      pass unchanged. The other three showed failures at first, but each was
      confirmed — by re-running against a controlled stash of this track's
      own changes, restoring the exact pre-track baseline — to fail
      IDENTICALLY on unmodified code:
      - `track-1110-claim-race-api-mode` and `local-api-e2e`: the documented
        `track_10082_worktree_test_redirect_hazard` (see MEMORY.md) — neither
        test's tmp project dir is its own git repo, so `resolvePrimaryRepoRoot`
        redirects the spawned worker to register against the REAL primary
        checkout when run from inside this track's own worktree. Pre-existing
        test fragility, not a regression.
      - `cloud-route-parity`: one pre-existing unserved call,
        `GET /project/1/dispatch/claimed-by-offline-workers`, present and
        identical on the unmodified baseline — unrelated to this track.
- [x] Task 6.2: Verified via TC-5.4 (an unreachable non-primary collector
      never blocks the spawn — the run starts and completes normally) and via
      the unmodified track-10064 retry-buffer e2e suite (still green,
      confirming a failed non-primary write is queued and replayed once the
      collector recovers — this track's fan-out sites all route through the
      same `patchCollectors`/retry-buffer machinery, unchanged). **Not done**:
      watching a real worker's Kanban card show the "SYNC DEGRADED" badge —
      that's a live-UI observation this session has no browser access to
      make; a human should confirm it visually once Task 2.5's deploy lands.
- [x] Task 6.3: Checked after every e2e run (`ps aux | grep laneconductor.sync.mjs`
      before and after). No leaked test workers at any point — the 5 real
      processes present throughout this session were all pre-existing,
      legitimate workers from the primary checkout and other projects
      (verified via `/proc/<pid>/cwd`), confirmed unchanged in count and
      identity across every check.
- [x] Task 6.4: Updated — two new paragraphs added after the retry-buffer
      paragraph, covering the fan-out fix (RC-1/RC-2) and the claim-guard
      (RC-3), plus a cross-reference from "Related silent-failure tracks".
- [x] Task 6.5: Filed as
      [AM-10084](../AM-10084-post-track-field-parity-gap-on-cloud-collector/index.md),
      referenced from `spec.md`'s Non-Goals.
- [ ] Task 6.6: **NOT DONE — requires human action**, and blocked on Task 2.5
      landing first (several acceptance criteria are specifically about what
      the REMOTE dashboard shows, which needs the cloud deploy to reflect
      this track's fix at all). Every acceptance criterion this session
      *could* verify without a live deploy or a browser was verified via the
      test suites above (each one's own test.md entry says how). The three
      criteria that name `app.laneconductor.com`/the Kanban UI directly
      remain open for a human to check post-deploy.

## ✅ COMPLETE (implementation)

All code-level tasks across Phases 1-6 are done, tested (13 new automated
tests across 4 suites, all passing; verified to fail pre-fix and pass
post-fix via controlled stash/restore for each phase), and the existing
regression suite this track's changes touch (track 10064's collector-health
and retry-buffer suites) is unchanged and green. Two tasks are explicitly
NOT done because they require actions this session cannot take
autonomously: Task 2.5 (deploying `cloud/functions/index.js` to production)
and Task 6.6 (visually confirming the live dashboard against that deploy).
Both are called out above with what a human needs to do next.

## ✅ REVIEWED

Review passed 2026-09-09. Code re-checked directly (SQL param alignment, claimed_by/ownMachineTokens consistency, claim-guard ordering) and 4 new test suites + Jest suite + both 10064 regression suites re-run and confirmed green; cloud-route-parity's single failure re-confirmed as the pre-existing unrelated gap. One new non-blocking finding recorded in conversation.md: conductor/deployment-stack.md claims Cloud Functions are decommissioned, contradicting this track's own live evidence of an active remote collector — flag for whoever runs the deferred Task 2.5 deploy. Moved to quality-gate.

## ✅ QUALITY PASSED

Quality gate passed 2026-09-09. Full worker suite (1083 tests) and UI/server suite (851 tests) both re-run fresh; every failure traced to a specific pre-existing cause (worktree-test-redirect hazard, or byte-for-byte identical against the pre-track baseline via a controlled file-swap) rather than assumed. Two real process leaks from this run (7 from the worker suite, 1 from vitest) were found and killed. Stub scan and acceptance-criteria review clean. Tasks 2.5/6.6 remain correctly deferred to a human (production deploy + live dashboard check) — judged as non-blocking for done-gate since the shipped fix itself is real and end-to-end tested, not stubbed. Moved to done:queue for merge.
