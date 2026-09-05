# Spec: local-api-e2e on_success/on_failure subtests time out

## Problem Statement

Two subtests in `conductor/tests/local-api-e2e.test.mjs` fail on every run:

- `on_success: implement → review` — `poll timeout (20000ms): lane → review (queue)`
- `on_failure: quality-gate exhausts retries → failure status` — `poll timeout (20000ms): lane_action_status → failure`

The track's intake framed this as an unknown defect somewhere in the worker's
on_success/on_failure dispatch path. **It is not.** Investigation during planning
reproduced both failures and identified both causes. Neither is a worker bug —
the lane-transition logic is correct. Both are defects in the *test fixture*: the
20-second poll deadline is marginally shorter than the wall-clock the worker
genuinely needs, because every lane action costs one full tick of a hardcoded
5-second auto-launch loop.

## Evidence gathered during planning

All measurements from this worktree, `node --test conductor/tests/local-api-e2e.test.mjs`.

| Run | Result | Duration |
|---|---|---|
| `on_success` subtest, full suite | FAIL (poll timeout) | 20.4s |
| `on_success` subtest, run alone via `--test-name-pattern` | PASS | 5.6s |
| `on_success` subtest, after `parallelism` subtest, poll timeout raised to 90s | PASS | 20.7s |
| `on_failure` subtest, run alone via `--test-name-pattern` | FAIL (poll timeout) | 20.4s |
| `on_failure` subtest, run alone, poll timeout raised to 90s | PASS | 20.7s |
| `remote-api` subtest (identical assertions, own fresh sandbox) | PASS | 5.6s |

The last row is the decisive one. The `remote-api` subtest asserts exactly the
same thing as `on_success` — a track moving to `review`/`queue` — and passes in
5.6s, because its `describe` block gets its own sandbox containing one track.

## Root cause 1 — leftover tracks accumulate in a shared sandbox

The five `local-api` subtests share a single sandbox created once in `before()`.
`setupProject()` resets the mock collector's in-memory state on each subtest but
**never removes the track folders the previous subtest wrote to
`conductor/tracks/`**. It only rewrites the config files.

So by the time `on_success` starts, the sandbox already holds tracks 101, 102 and
103 left behind by the `parallelism` subtest, all sitting in `implement:queue`,
alongside its own new track 201. The `implement` lane has `parallel_limit: 1`, so
the worker drains them one at a time. Four tracks at one auto-launch tick each is
20 seconds before track 201 is even claimed — just past the 20s deadline.

## Root cause 2 — the assertion is reached only via a three-lane cascade

The `on_failure` subtest creates track 301 in `quality-gate:queue` with a mock CLI
that always exits 1, and asserts `lane_action_status === 'failure'`.

But the suite's own fixture sets `'quality-gate': { on_failure: 'review' }`.
`resolveTransition()` (`conductor/laneconductor.sync.mjs:1859`) gives a lane that
*moves* the status `queue`, never `failure` — `failure` is only produced when the
transition *stays* in the same lane. So retry exhaustion in `quality-gate` moves
the track to `review:queue`, not to a failure status.

The track does eventually reach `failure`, but only after cascading
`quality-gate` → `review` → `implement`, where `implement.on_failure: 'implement'`
stays in-lane and finally yields `failure`. That is six-plus lane actions, again
one tick apiece. The subtest's name claims it verifies quality-gate retry
exhaustion; what it actually observes is failure in a completely different lane,
several transitions later, and only if given enough time.

## Root cause 3 (amplifier) — the auto-launch loop has no test override

`conductor/laneconductor.sync.mjs:8938` schedules the auto-launch loop at a
hardcoded `5000`ms. Every other timing loop in that file already accepts a
test-only env override on the established convention — `LC_HEARTBEAT_INTERVAL_MS`
(line 3063), `LC_RECONCILE_INTERVAL_MS` (line 4551), `LC_DOC_SYNC_INTERVAL_MS`
(line 4648), `LC_DIRTY_RETRY_INTERVAL_MS` (line 4877). The one loop that governs
how fast a lane action is claimed is the one loop that cannot be sped up, which
is why every multi-step assertion in this suite sits within a second of its
deadline.

## Requirements

- REQ-1: Each subtest in `local-api-e2e.test.mjs` starts against a
  `conductor/tracks/` directory containing only the tracks that subtest created.
  No track written by a previous subtest may still be claimable.
- REQ-2: The `on_failure` subtest verifies what its name says — retry exhaustion
  **in the quality-gate lane** producing a failure status in that lane — rather
  than incidentally observing a failure several lanes downstream.
- REQ-3: The worker's auto-launch loop interval is overridable via
  `LC_AUTO_LAUNCH_INTERVAL_MS`, defaulting to the current `5000`ms when unset, so
  production behaviour is byte-for-byte unchanged and tests can drive the loop
  fast.
- REQ-4: The suite passes all six subtests, repeatably, run both as a whole file
  and subtest-by-subtest via `--test-name-pattern`.
- REQ-5: No change to `resolveTransition()` or any on_success/on_failure dispatch
  logic in `conductor/laneconductor.sync.mjs`. That logic is correct; the only
  production-code change permitted by this track is REQ-3's env override.
- REQ-6: No subtest is fixed by raising its poll timeout alone. A deadline raise
  is acceptable only alongside the isolation and interval fixes, as margin.

## Acceptance Criteria

- [ ] `node --test conductor/tests/local-api-e2e.test.mjs` reports 6 passing, 0
      failing, on three consecutive runs.
- [ ] Each of the six subtests passes when run alone via `--test-name-pattern`,
      proving no subtest depends on another subtest having run first.
- [ ] The whole file completes in well under its current ~84s, demonstrating the
      auto-launch override is actually in effect during the run.
- [ ] `git diff` on `conductor/laneconductor.sync.mjs` shows only the
      `LC_AUTO_LAUNCH_INTERVAL_MS` override, and running the worker with that
      variable unset claims tracks on the same 5s cadence as before.
- [ ] The `on_failure` subtest asserts both `lane_status === 'quality-gate'` and
      `lane_action_status === 'failure'`, so a future regression that reroutes the
      track through other lanes fails the test rather than passing slowly.
- [ ] `conductor/tests/local-fs-e2e.test.mjs` and the other suites that spawn the
      real worker still pass, confirming the interval override did not disturb
      them.

## Out of Scope

- The vestigial `PATCH /track/:num/block` route in
  `conductor/tests/mock-collector.mjs`. The worker has never called it, at any
  commit in this repo's history. It is dead fixture surface, not a missing
  worker call, and removing it is unrelated cleanup.
- Any change to how `parallel_limit` or retry counting works.
