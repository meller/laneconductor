
## Track Creation Requests


## Completed Queue

### Track 10012: inbox functionality fix
**Status**: processed
**Type**: track-create
**Created**: 2026-08-14T14:46:14.667Z
**Title**: inbox functionality fix
**Description**: we need to make sure that when a track action (converastion, or end of plan implementation, review, qualitty gate) ends inbox get populated to notify user a succefull end of action or if he needs to intervene - now we have in inbox unclear things
**Processed**: 2026-08-14T14:46:17.529Z

### Track 10015: F15 live verification (disposable)
**Status**: processed
**Type**: track-create
**Created**: 2026-08-15T09:33:55.756Z
**Title**: F15 live verification (disposable)
**Description**: No description.
**Processed**: 2026-08-15T09:33:56.432Z

### Track 10019: Track 10013 Phase 5 live-verify scratch
**Status**: processed
**Type**: track-create
**Created**: 2026-08-18T09:37:27.148Z
**Title**: Track 10013 Phase 5 live-verify scratch
**Description**: disposable — verifying human-lane-override guard live
**Processed**: 2026-08-18T09:37:28.097Z

### Track 1116: Per-lane provider + live-model picker in Workflow Settings
**Status**: processed
**Type**: track-create
**Created**: 2026-08-18T11:50:00.000Z
**Title**: Per-lane provider + live-model picker in Workflow Settings
**Description**: Add provider + live-discovered model selection to the Workflow Settings Visual Editor's per-lane config, replacing the static claude-only model list with the same worker-reported available_models WorkerModelModal.jsx already uses, defaulting to Claude / Sonnet 5. Depends on 1111 (per-lane primary_model field/precedence, must merge first) and 1099 (dynamic worker model discovery, source of available_models). Plan only — do not implement yet.
**Processed**: 2026-08-18T09:51:18.859Z

### Track 1117: Fix unscoped worker-startup reset + backwards orphan-reconcile guard
**Status**: processed
**Type**: track-create
**Created**: 2026-08-18T18:50:00.000Z
**Title**: Fix unscoped worker-startup reset + backwards orphan-reconcile guard
**Description**: Two compounding sync-engine bugs found live during track 1116's dogfood run: (1) resetStuckActions(immediate=true) fires on every worker startup and resets ALL running/queued tracks project-wide with no ownership/liveness check, incorrectly marking live tracks as stuck_timeout; (2) orphan-reconcile's artifact-copy guard treats a worktree lane that has legitimately advanced past the dispatched action (i.e. a successful run) as a mismatch and skips copying, permanently stranding correct newer state. Together these silently orphaned a fully-successful 1116 implement run for its entire ~45min duration with no automatic recovery. Root-caused to exact file/line locations; plan only for now.
**Processed**: 2026-08-18T18:48:37.699Z

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
**Status**: processed
**Type**: track-create
**Created**: 2026-08-21T08:00:00Z
**Title**: make install — end-to-end DB provisioning & lc setup integration
**Description**: make install should provision Postgres (Docker or native), run migrations, start the UI, and guide the user to lc setup — zero manual steps after clone.
**Processed**: 2026-08-21T07:18:31.000Z

### Track 10024: Worktrees panel: live run visibility
**Status**: processed
**Type**: track-create
**Created**: 2026-08-24T10:23:01.304Z
**Title**: Worktrees panel: live run visibility
**Description**: When a Worktrees panel row is running an action (Complete & Merge, AI resolve conflict, a re-triggered lane dispatch), the row just shows a static 'Running…' badge with no way to see which worker picked it up or what it's actually doing. The Workers view already solves this exact problem for any worker's current task via WorkerActivityLatch (ui/src/components/WorkerActivityLatch.jsx, Track 1087 Phase 5) — a global side panel showing a worker's live streaming transcript, reachable from anywhere.

Goal: when a Worktrees panel row is running, make it clickable (or add a small button) that opens the live transcript for the worker handling that track's dispatch — reusing WorkerActivityLatch rather than building a new transcript UI.

Known gap to solve as part of this: the worktrees API response (GET /api/projects/:id/worktrees, and the worker heartbeat's embedded worktrees payload in conductor/laneconductor.sync.mjs) does not currently include which worker_id (if any) is actively running a dispatch against a given track. That needs to be joined in — e.g. from worker_dispatch rows with status='running' or 'claimed' for that track_number, or from workers.current_task — before the UI can know which worker to link to.

Requirements:
- A running worktree row shows which worker (hostname/worker_number) is handling it, not just 'Running…'.
- Clicking through opens that worker's live transcript (WorkerActivityLatch), pre-selected to the right worker.
- Works for all worktree-triggered actions: auto-complete-track, ai-resolve-conflict, merge-worktree, and a plain lane re-dispatch.
- If no worker is actually running anything for that track (e.g. stale 'Running…' state after a crash), show that clearly instead of a misleading spinner.
- Real test coverage (unit test for the worker-join logic, plus a real spawned-worker/dispatch test proving the API returns the correct worker_id — mirror the existing test patterns in conductor/tests/, e.g. track-10018-pr-flow-e2e.test.mjs's real-subprocess approach) and a real browser check that the click-through actually opens the transcript before marking this done.
**Processed**: 2026-08-24T10:23:02.055Z
