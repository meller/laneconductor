

## Completed Queue

### Track 10021: Slow-tier Playwright specs need self-scoped workers
**Status**: processed
**Type**: track-create
**Created**: 2026-08-20T12:07:02.965Z
**Title**: Slow-tier Playwright specs need self-scoped workers
**Description**: Follow-up from track 1100 Review #3's Gap 2 and track-1033-sharing findings (2026-08-20). Both blockers on the slow Playwright tier come down to the same root cause: the specs depend on shared live infrastructure (an ambient sync+poll worker able to claim ANY queued track, or the shared ui/server/index.mjs instance on :8091 that every other in-flight track also depends on) rather than bringing their own isolated infrastructure.

1. v1/new-track-plan self-scoping rewrite (Gap 2, unscoped half). brainstorm-concurrency.spec.js and new-track-plan.spec.js drive real track creation through the live UI, so the resulting track number isn't known ahead of time and can't be passed to track 1109's --only-tracks allowlist before the worker starts — unlike brainstorm-concurrency-v2.spec.js, which already works today because it uses hardcoded track numbers (991/992). Verified live (2026-08-20): running v2 via `lc worker start --sync-and-work --only-tracks 991,992 --once` + the spec touched ONLY 991/992 — no other queued track (10003-10007 etc.) was affected — proving the --only-tracks scoping mechanism itself is sound. The fix: teach v1 and new-track-plan to read back the track number the UI just returned after creation, then spawn their OWN throwaway `--only-tracks <n> --once` worker scoped to that single track, instead of depending on an ambient --sync-and-work worker that has to be started externally and can touch anything queued. This also makes the slow tier runnable in CI, where no ambient worker exists at all.

   Note: v2's own assertion is currently stale and reports a false failure — it checks conversation.md for `> **assistant**:` but the actual format writer uses `> **claude**:`. Worth fixing as a one-line part of this same track, verified live: the real brainstorm reply landed correctly in conversation.md, the assertion text just doesn't match reality.

2. Dedicated PW_TEST_MODE server for track-1033-sharing.spec.js (6 tests, always skipped). Enabling this tier currently requires restarting the LIVE shared ui/server/index.mjs (the same process serving :8091 for every other in-flight track) with PW_TEST_MODE=true, an auth-bypass mode, on infrastructure other people's work depends on for the run's duration — not something to toggle unilaterally on a shared instance. The clean fix: a dedicated PW_TEST_MODE server on its own port, spun up just for this one spec file, leaving the shared :8091 instance untouched.

Both items were explicitly scoped out of track 1100 itself per its review's own guidance ("not something to improvise inside this pass") and out of the live v2 experiment run during that review's follow-up — filed here as the reviewed, planned change they call for.
**Processed**: 2026-08-20T12:07:08.111Z


### Track 10022: make install — end-to-end DB provisioning & lc setup integration
**Status**: pending
**Type**: track-create
**Created**: 2026-08-21T08:00:00Z
**Title**: make install — end-to-end DB provisioning & lc setup integration
**Description**: make install should provision Postgres (Docker or native), run migrations, start the UI, and guide the user to lc setup — zero manual steps after clone.
**Metadata**: { "priority": "high", "assignee": null }
