# Tests: Track AM-10083 — Lane action status transitions go local-only

## Test Commands

```bash
# The three new suites for this track
node --test conductor/tests/track-10083-status-fanout-e2e.test.mjs
node --test conductor/tests/track-10083-cloud-upsert-lane-action-status.test.mjs
node --test conductor/tests/track-10083-claim-mirror-guard.test.mjs

# Suites this track's changes touch directly — must stay green
node --test conductor/tests/track-10064-collector-health.test.mjs
node --test conductor/tests/track-10064-collector-health-e2e.test.mjs
node --test conductor/tests/track-10064-collector-retry.test.mjs
node --test conductor/tests/track-10064-collector-retry-e2e.test.mjs
node --test conductor/tests/cloud-route-parity.test.mjs
node --test conductor/tests/local-api-e2e.test.mjs

# Full worker suite
node --test conductor/tests/

# Server/UI suite
cd ui && npx vitest run
```

**Before trusting any result from the two commands above that run whole
directories**, check for leaked worker processes — both runners have left
real workers running against the primary checkout in this repo before:

```bash
ps aux | grep -c '[l]aneconductor.sync.mjs'
```

## Test Cases

### Phase 1 — Reproduction (each must FAIL before Phase 2)

- [ ] TC-1.1: Two mock collectors configured, real worker started, lane
      action dispatched — expected: both collectors report
      `lane_action_status: 'running'`. Fails today because only the first
      receives the write.
- [ ] TC-1.2: The failure in TC-1.1 is the missing second write, not a
      harness error — expected: the first collector does show `running`, so
      the test discriminates the bug from a broken setup.
- [ ] TC-1.3: Cloud `POST /track` with payload `lane_action_status: 'running'`
      against an existing row at `queue`, lane unchanged — expected: row
      becomes `running`. Fails today; the `ON CONFLICT` clause returns the
      existing value.
- [ ] TC-1.4: Cloud `POST /track` with payload `lane_action_status: 'queue'`
      against an existing row at `running` — expected: row becomes `queue`.
      Fails today; the sticky branch pins it at `running`.
- [ ] TC-1.5: Local and cloud `POST /track` given identical payloads reach the
      same `lane_action_status` — expected: identical. Fails today.

### Phase 2 — Cloud upsert

- [ ] TC-2.1: Payload supplies a status, lane unchanged — expected: payload
      value is written.
- [ ] TC-2.2: Payload omits the status, lane changes — expected: row resets to
      `queue` and `lane_action_result` clears. This is today's behaviour and
      must not change.
- [ ] TC-2.3: Payload omits the status, lane unchanged — expected: existing
      value untouched. Also today's behaviour.
- [ ] TC-2.4: Payload supplies a status with `lane_status` null — expected:
      the status is still written. Today the whole clause is dropped.
- [ ] TC-2.5: Payload supplies `waiting` — expected: `waiting_reason` handling
      is unchanged from today, per track 10055.
- [ ] TC-2.6: A row inserted for the first time with an explicit status —
      expected: unchanged from today, the insert path already worked.

### Phase 3 — Fan-out

- [ ] TC-3.1: Lane action starts — expected: every collector sees `running`
      within one heartbeat, without any file-watch event.
- [ ] TC-3.2: Lane action completes — expected: every collector sees the
      terminal status and result.
- [ ] TC-3.3: Spawn fails — expected: every collector sees the reverted
      status, not a stranded `running`.
- [ ] TC-3.4: Timeout kill — expected: every collector sees `failure` /
      `timeout`.
- [ ] TC-3.5: A `/worker-dispatch/:id` write is observed on the primary only —
      expected: the second collector records no dispatch write. This is the
      guard that the fan-out was not applied too broadly.
- [ ] TC-3.6: The 5-second `last_log_tail` telemetry patch reaches the primary
      only — expected: the second collector's request count does not grow
      with run duration.

### Phase 4 — Per-collector project id

- [ ] TC-4.1: Two collectors return different project ids from
      `/project/ensure` — expected: each subsequent request carries the id
      that collector returned.
- [ ] TC-4.2: After a worker start against both, `.laneconductor.json`'s
      `project.id` still names the local project — expected: unchanged by the
      remote collector's answer.
- [ ] TC-4.3: A collector that has not answered `/project/ensure` yet —
      expected: falls back to the config's `project.id`, same as today.
- [ ] TC-4.4: Single-collector project — expected: behaviour identical to
      before this track.

### Phase 5 — Claim mirror and pre-spawn guard

- [ ] TC-5.1: Claim won on the primary — expected: `running` is mirrored to
      every other collector before the spawn.
- [ ] TC-5.2: A non-primary collector reports the track running under a
      different claimant — expected: the spawn is refused, and one
      `> **system**:` comment naming the other claimant appears in
      `conversation.md`.
- [ ] TC-5.3: A non-primary collector reports the track running under this
      same worker — expected: the spawn proceeds. This worker's own mirror
      must not block it.
- [ ] TC-5.4: A non-primary collector is unreachable — expected: the spawn
      proceeds.
- [ ] TC-5.5: A non-primary collector times out — expected: the spawn
      proceeds, and the check does not extend spawn latency beyond its own
      short timeout.
- [ ] TC-5.6: A non-primary collector returns 403 or an unparseable body —
      expected: the spawn proceeds.

### Phase 6 — Degraded path and regression

- [ ] TC-6.1: Remote collector offline for a full lane action — expected: the
      run starts, completes, and lands on the correct lane.
- [ ] TC-6.2: During that outage — expected: the worker card shows the
      degraded-sync badge from track 10064.
- [ ] TC-6.3: Remote collector restored — expected: the missed status writes
      are replayed from the retry buffer and the remote state matches the
      local state, with no file touched by hand.
- [ ] TC-6.4: Primary collector fails a status write — expected: the same
      error surfaces as today, at the same log level. The fan-out must not
      change how a primary failure is reported.

## Acceptance Criteria

- [ ] Every Phase 1 test was observed failing before any production change,
      and passes after.
- [ ] The full worker suite and the UI suite pass, with no leaked worker
      processes afterwards.
- [ ] Each acceptance criterion in `spec.md` was checked against the real
      dashboard and the observation recorded, not inferred from the code.
- [ ] The cloud function change is deployed and verified against the live
      remote collector, not only against a local harness.
