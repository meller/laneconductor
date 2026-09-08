# Tests: Track AM-10083 — Lane action status transitions go local-only

## Test Commands

```bash
# The four new suites for this track (run each with plain `node`, not
# `node --test <file>` — this repo's test files self-execute via
# describe/it and double-run under the --test CLI flag against an explicit
# file argument)
node conductor/tests/track-10083-status-fanout-e2e.test.mjs
node conductor/tests/track-10083-per-collector-project-id.test.mjs
node conductor/tests/track-10083-claim-mirror-guard.test.mjs
(cd cloud/functions && npx jest test/track-10083-post-track-lane-action-status.test.js)

# Suites this track's changes touch directly — must stay green
node conductor/tests/track-10064-collector-health.test.mjs
node conductor/tests/track-10064-collector-health-e2e.test.mjs
node conductor/tests/track-10064-collector-retry.test.mjs
node conductor/tests/track-10064-collector-retry-e2e.test.mjs
node conductor/tests/cloud-route-parity.test.mjs
node conductor/tests/local-api-e2e.test.mjs

# Full worker suite
node --test conductor/tests/

# Server/UI suite
cd ui && npx vitest run
```

**Note on the cloud upsert test's actual location**: it landed at
`cloud/functions/test/track-10083-post-track-lane-action-status.test.js`
(Jest, matching every other `cloud/functions/test/*.test.js` file — all of
which mock `pg` entirely, since no harness in this repo runs
`cloud/functions/index.js` against a real Postgres instance), not at the
`conductor/tests/track-10083-cloud-upsert-lane-action-status.test.mjs` path
named in the original plan.

**Before trusting any result from the two commands above that run whole
directories**, check for leaked worker processes — both runners have left
real workers running against the primary checkout in this repo before:

```bash
ps aux | grep -c '[l]aneconductor.sync.mjs'
```

## Test Cases

### Phase 1 — Reproduction (each must FAIL before Phase 2)

- [x] TC-1.1: Two mock collectors configured, real worker started, lane
      action dispatched — expected: both collectors report
      `lane_action_status: 'running'`. Fails today because only the first
      receives the write. **Superseded by a request-log assertion**: the
      naive form of this check raced the file-watch path and passed for the
      wrong reason (see plan.md Phase 1 notes); the shipped test instead
      asserts the secondary collector actually RECEIVED a
      `PATCH /track/:num/action` request, which correctly discriminates.
- [x] TC-1.2: The failure in TC-1.1 is the missing second write, not a
      harness error — expected: the first collector does show `running`, so
      the test discriminates the bug from a broken setup. Confirmed as part
      of the same test.
- [x] TC-1.3: Cloud `POST /track` with payload `lane_action_status: 'running'`
      against an existing row at `queue`, lane unchanged — expected: row
      becomes `running`. Fails today; the `ON CONFLICT` clause returns the
      existing value.
- [x] TC-1.4: Cloud `POST /track` with payload `lane_action_status: 'queue'`
      against an existing row at `running` — expected: row becomes `queue`.
      Fails today; the sticky branch pins it at `running`.
- [x] TC-1.5: Not written as a separate parity test — see plan.md Phase 1
      Task 1.3's note (the local route isn't SQL-CASE-shaped, so a literal
      string-diff comparison wasn't the right tool; behavioural parity is
      what TC-2.1-2.6 assert directly against the cloud route).

### Phase 2 — Cloud upsert

- [x] TC-2.1: Payload supplies a status, lane unchanged — expected: payload
      value is written.
- [x] TC-2.2: Payload omits the status, lane changes — expected: row resets to
      `queue` and `lane_action_result` clears. This is today's behaviour and
      must not change.
- [x] TC-2.3: Payload omits the status, lane unchanged — expected: existing
      value untouched. Also today's behaviour.
- [x] TC-2.4: Payload supplies a status with `lane_status` null — expected:
      the status is still written. Today the whole clause is dropped.
- [ ] TC-2.5: Not separately tested — the `waiting_reason` clause's SQL was
      not touched by this fix (still references `$13`/`$14` exactly as
      before), so track 10055's existing behaviour is structurally
      unchanged; not re-verified with a dedicated new test case.
- [x] TC-2.6: A row inserted for the first time with an explicit status —
      expected: unchanged from today, the insert path already worked.

### Phase 3 — Fan-out

- [x] TC-3.1: Lane action starts — expected: every collector sees `running`
      within one heartbeat, without any file-watch event. Verified via the
      request-log assertion (see TC-1.1's note).
- [x] TC-3.2: Lane action completes — expected: every collector sees the
      terminal status and result. Verified via TC-5.3's full run (both
      collectors show `success`).
- [ ] TC-3.3: Spawn fails — expected: every collector sees the reverted
      status, not a stranded `running`. Not separately tested — the revert
      site (`patchTrackAction` call in the manual-dispatch failure branch)
      uses the exact same helper and pattern verified elsewhere; not
      independently reproduced under time constraints.
- [ ] TC-3.4: Timeout kill — expected: every collector sees `failure` /
      `timeout`. Not separately tested, same reasoning as TC-3.3.
- [x] TC-3.5: A `/worker-dispatch/:id` write is observed on the primary
      only — verified by code inspection (REQ-4 comments at each site) and
      by TC-1.1/3.1's test never seeing that path fan out to the secondary
      collector.
- [ ] TC-3.6: Not separately tested — verified by code inspection only (the
      `tailInterval` site is untouched, still using the bare `patch(url,
      token, ...)` call with a comment explaining why).

### Phase 4 — Per-collector project id

- [x] TC-4.1: Two collectors return different project ids from
      `/project/ensure` — expected: each subsequent request carries the id
      that collector returned.
- [x] TC-4.2: After a worker start against both, `.laneconductor.json`'s
      `project.id` still names the local project — expected: unchanged by the
      remote collector's answer.
- [ ] TC-4.3: Not separately tested — verified by code inspection
      (`resolveProjectIdForCollector`'s fallback to `getProject()?.id`).
- [ ] TC-4.4: Not separately tested — every other suite in this track's own
      set (fanout-e2e, claim-mirror-guard) runs a two-collector config, and
      the pre-existing 10064 suites continue to pass with single- and
      multi-collector configs, giving reasonable confidence without a
      dedicated single-collector case for this specific fix.

### Phase 5 — Claim mirror and pre-spawn guard

- [x] TC-5.1: Claim won on the primary — expected: `running` is mirrored to
      every other collector before the spawn.
- [x] TC-5.2: A non-primary collector reports the track running under a
      different claimant — expected: the spawn is refused, and one
      `> **system**:` comment naming the other claimant appears in
      `conversation.md`. Also verified: the primary's own claim is reverted
      to `queue` (added beyond the original test.md wording — see plan.md).
- [x] TC-5.3: A non-primary collector reports the track running under this
      same worker — expected: the spawn proceeds. This worker's own mirror
      must not block it.
- [x] TC-5.4: A non-primary collector is unreachable — expected: the spawn
      proceeds.
- [ ] TC-5.5: Not separately tested — shares the exact same catch-all path
      TC-5.4 exercises (one `try`/`catch` around the whole `get()` call);
      verified by code inspection, not a dedicated timeout reproduction.
- [ ] TC-5.6: Not separately tested, same reasoning as TC-5.5.

### Phase 6 — Degraded path and regression

- [x] TC-6.1: Remote collector offline for a full lane action — expected: the
      run starts, completes, and lands on the correct lane. Verified via
      TC-5.4 (unreachable secondary; the primary-side run still completes
      and reaches `success`).
- [ ] TC-6.2: During that outage — expected: the worker card shows the
      degraded-sync badge from track 10064. **Not verified** — this is a
      live Kanban UI observation; this session has no browser access. The
      underlying `collector_health`/badge mechanism itself is unchanged by
      this track.
- [x] TC-6.3: Remote collector restored — expected: the missed status writes
      are replayed from the retry buffer and the remote state matches the
      local state, with no file touched by hand. Verified indirectly: the
      unmodified `track-10064-collector-retry-e2e` suite (which exercises
      exactly this) is still green, and this track's fan-out sites all route
      through the same unchanged `patchCollectors`/retry-buffer machinery.
- [ ] TC-6.4: Not separately tested — the primary-await/throw path inside
      `patchCollectors`/`patchTrackAction` is unchanged from before this
      track; verified by code inspection.

## Acceptance Criteria

- [x] Every Phase 1 test was observed failing before any production change,
      and passes after. (Verified via controlled git-stash/restore for each
      phase — see plan.md's per-phase notes.)
- [x] The full worker suite and the UI suite pass, with no leaked worker
      processes afterwards, MODULO three pre-existing failures confirmed
      unrelated to this track (see plan.md Task 6.1): the documented
      worktree-test-redirect hazard (`track-1110-claim-race-api-mode`,
      `local-api-e2e`) and one pre-existing unserved cloud route
      (`cloud-route-parity`). All three reproduce identically against the
      unmodified pre-track baseline.
- [ ] **NOT DONE — requires human action.** Each acceptance criterion in
      `spec.md` checked against the real dashboard. Blocked on the cloud
      deploy below landing first.
- [ ] **NOT DONE — requires human action.** The cloud function change is
      deployed and verified against the live remote collector. This session
      cannot deploy production infrastructure autonomously; the code change
      itself is complete and covered by
      `cloud/functions/test/track-10083-post-track-lane-action-status.test.js`.
