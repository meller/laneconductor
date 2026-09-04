# Tests: Track TU-10064 — Remote collector sync fails silently

New worker-side tests are `node:test` (they spawn real processes and touch
the filesystem, per `conductor/tech-stack.md`'s rules). The UI indicator is
Vitest plus one real-browser check.

## Test Commands

```bash
# New suites for this track
node --test conductor/tests/track-10064-config-root.test.mjs
node --test conductor/tests/track-10064-env-reload.test.mjs
node --test conductor/tests/track-10064-collector-health.test.mjs
node --test conductor/tests/track-10064-collector-retry.test.mjs

# Regression: the existing collector/worker suites must stay green
node --test conductor/tests/local-api-e2e.test.mjs
node --test conductor/tests/primary-root-normalization.test.mjs
node --test conductor/tests/per-worker-machine-token.test.mjs
node --test conductor/tests/collector-content-type.test.mjs

# UI
cd ui && npm test

# Real-browser check for Phase 5
cd ui && npx playwright test
```

`conductor/tests/mock-target.mjs` is the existing zero-dependency mock
collector; extend it (or add a sibling) to assert on inbound
`Authorization` headers and to return `401 {"error":"unauthorized: missing
token"}` when the header is absent, mirroring
`cloud/functions/index.js:225`.

## Test Cases

### Phase 1: Config root resolution

- [ ] TC-1: `resolveConfigRoot({ cwd: <linked worktree>, resolvePrimaryRepoRoot })`
      returns the primary checkout root, not the worktree.
- [ ] TC-2: `resolveConfigRoot` with a stubbed resolver that throws returns
      `cwd` unchanged and does not throw.
- [ ] TC-3: A worker spawned with cwd inside a linked worktree and
      `LC_SKIP_CWD_NORMALIZATION=1` sends `Authorization: Bearer <token>` to
      the mock collector. Expected: header present, no `401`. Without the
      fix this test fails, which is the point.
- [ ] TC-4: A worker spawned with `--manager` from an arbitrary cwd sends
      the `Authorization` header. Expected: header present.
- [ ] TC-5: `conductor/defaults.json` and `.laneconductor.json` are read
      from the primary root when the worker is launched from a worktree.
- [ ] TC-6: A worker started outside any git repo starts normally and reads
      `.env` from cwd. Expected: no crash, existing behavior preserved.

### Phase 2: `.env` reload

- [ ] TC-7: Worker starts with `collectors: [local]` and no
      `COLLECTOR_1_TOKEN`. A remote collector is appended to
      `.laneconductor.json` and its token written to `.env`. Expected: the
      next remote write from that same process carries the token; no
      restart.
- [ ] TC-8: A value set in the real process environment is not overwritten
      by a differing `.env` value on reload. Expected: process env wins,
      matching today's `!process.env[key]` precedence.
- [ ] TC-9: Changing an existing `COLLECTOR_1_TOKEN` in `.env` and touching
      `.laneconductor.json` causes the new token to be sent. Expected: the
      mock collector sees the new value, proving `tokenCache` was
      invalidated.
- [ ] TC-10: A reload with no `.env` change sends the same token and logs no
      token-source-change line.

### Phase 3: Loud resolution and health tracking

- [ ] TC-11: Startup with two enabled collectors logs exactly one token-source
      line per collector, naming the URL and source.
- [ ] TC-12: A collector with no resolvable token logs at `error` naming the
      expected env key (`COLLECTOR_1_TOKEN`) before any request is sent.
      Expected: the error precedes the first outbound request in the log.
- [ ] TC-13: One failing remote write logs at `warn` and sets
      `consecutive_failures` to 1.
- [ ] TC-14: Five consecutive failures produce exactly one escalated `error`
      line. Expected: one, not five.
- [ ] TC-15: Failures six through one hundred within the throttle window
      produce zero additional escalated lines. This is the direct regression
      test for the 560-line flood.
- [ ] TC-16: A success after failures logs one `info` recovery line and
      resets `consecutive_failures` to 0 and `last_success_at`.
- [ ] TC-17: Collector 0 failures are recorded in the health map too, not
      only collectors 1..n.

### Phase 4: Heartbeat and persistence

- [ ] TC-18: `/worker/register` payload includes `collector_health` with one
      entry per configured collector.
- [ ] TC-19: `/worker/heartbeat` payload includes updated
      `collector_health`.
- [ ] TC-20: The server persists `collector_health` and the workers read
      endpoint returns it.
- [ ] TC-21: A register payload with `collector_health` absent (older
      worker) succeeds and leaves the column null. Expected: no error, no
      migration required of the caller.
- [ ] TC-22: The migration is idempotent — running it twice succeeds.

### Phase 5: UI indicator and retry

- [ ] TC-23: `WorkersList` renders a degraded-sync indicator for a worker
      whose `collector_health` has a failing collector, showing the URL and
      consecutive-failure count.
- [ ] TC-24: `WorkersList` renders no new chrome for a healthy worker.
- [ ] TC-25: `WorkersList` renders no new chrome when `collector_health` is
      null (older worker row).
- [ ] TC-26: Real-browser check — start the UI, seed a worker with a failing
      collector, confirm the indicator is visible and the error text is
      reachable. Record a screenshot or the actual rendered text. A passing
      unit test does not satisfy this.
- [ ] TC-27: A write failing against an unreachable mock collector is
      replayed successfully once the mock starts answering.
- [ ] TC-28: Five patches to the same track while the collector is down
      replay as one request carrying the newest body.
- [ ] TC-29: The retry buffer stops at `LC_COLLECTOR_RETRY_MAX` and logs the
      eviction of the oldest entry. Expected: bounded memory, visible drop.
- [ ] TC-30: A token-source change clears the retry buffer rather than
      replaying requests built with the stale credential.

### Phase 6: Documentation

- [ ] TC-31: `conductor/product.md` states that the worker owns remote sync
      and the local API server does not write to the cloud.
- [ ] TC-32: The new env vars and the `.env`-reload behavior are documented.

## Acceptance Criteria

- [ ] All new and existing `node:test` suites listed above pass.
- [ ] `cd ui && npm test` passes with no regressions.
- [ ] TC-3 and TC-7 both fail against the pre-fix code and pass after — the
      two tests that pin the actual defects.
- [ ] TC-15 is green, meaning a 560-failure flood cannot recur in the log.
- [ ] TC-26 was performed against a real running UI with the observation
      recorded, not inferred from TC-23.
- [ ] `grep -rniE "not yet implemented|TODO|FIXME|FFU" conductor ui bin`
      returns nothing in code paths this track marks complete.
