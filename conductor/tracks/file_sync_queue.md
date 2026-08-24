

## Completed Queue

### Track 10015: F15 live verification (disposable)
**Status**: processed
**Type**: track-create
**Created**: 2026-08-15T09:33:55.756Z
**Title**: F15 live verification (disposable)
**Description**: No description.
**Processed**: 2026-08-15T09:33:56.432Z

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
