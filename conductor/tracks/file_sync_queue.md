## Track Creation Requests


## Completed Queue

### Track 1121: Mobile UX — focus-first board
**Status**: processed
**Type**: track-create
**Created**: 2026-09-04T14:34:04.000Z
**Title**: Mobile UX — focus-first board
**Description**: app.laneconductor.com is unusable on a phone. KanbanBoard.jsx renders a hard-coded `grid grid-cols-6` with no breakpoints (~41px lanes at 375px), and TrackCard.jsx moves cards via HTML5 drag-and-drop, which does nothing on touch — so moving a track is impossible on mobile even if the lanes fit. TrackDetailPanel is a fixed w-96/max-w-2xl side panel wider than the viewport, and only 7 of 35 components carry any responsive treatment. Implements the approved "focus-first" design (direction B): mobile app shell with bottom tabs, a swipeable one-lane-at-a-time board, a tap-to-move sheet replacing drag, an attention-led Focus home reusing the existing /api/inbox classification, and a full-screen track detail. Desktop behaviour unchanged. Design canvas: https://claude.ai/code/artifact/7440ac62-4817-47b8-bdf7-679f84970901
**Author**: TU
**Processed**: 2026-09-04T14:34:49.447Z

### Track 10053: Port missing worker routes to the cloud function
**Status**: processed
**Type**: track-create
**Created**: 2026-09-03T10:09:59.000Z
**Title**: Port missing worker routes to the cloud function
**Description**: Seven route families the sync worker calls exist in ui/server/index.mjs but are missing from cloud/functions/index.js (/projects/:id/workflow, /worker-dispatch/:id, /api/projects/:id/claimable-tracks, /tracks/claim-queue, /track/:num/prespawn-block(+/reset), /track/:num/session, /track/:num/lock+/unlock). A worker pointed at app.laneconductor.com registers successfully (that route exists) and then cannot claim, lock, or coordinate any work. Split out of track 10052, which fixed the Hosting rewrite glob layer and caveated cloud onboarding but deliberately did not port these routes. Same class of gap as track 1046 (/api/keys).
**Author**: TU
**Processed**: 2026-09-03T10:10:00.562Z

### Track 10046: local-fs-answer Overwrites Lane With a Stale Snapshot Under Concurrent Dispatch
**Status**: processed
**Type**: track-create
**Created**: 2026-08-31T08:05:37.000Z
**Title**: local-fs-answer Overwrites Lane With a Stale Snapshot Under Concurrent Dispatch
**Description**: Live incident 2026-08-31 (track AM-10045): Lane flapped implement->plan->implement 6 times in ~90s. The conversation-reply (local-fs-answer) handler force-writes Lane back to a snapshot captured at its OWN dispatch time, ignoring a concurrent lane-action dispatch's later transition -- silently reverting real work. Discovered and documented live by another concurrent session; filed for a dedicated fix (re-read-before-write, or narrow what a reply turn may touch).
**Author**: AM
**Processed**: 2026-08-31T08:05:38.527Z

### Track 10045: E2E Test Suites Spawn a Real Worktree-Scoped Sync Worker Instead of an Isolated One
**Status**: processed
**Type**: track-create
**Created**: 2026-08-30T20:37:03.000Z
**Title**: E2E Test Suites Spawn a Real Worktree-Scoped Sync Worker Instead of an Isolated One
**Description**: Live incident 2026-08-30: 26 duplicate laneconductor.sync.mjs processes (load avg 17-20 on 16 cores, 39GB RAM). local-fs-e2e.test.mjs/local-api-e2e.test.mjs resolve the worker script via __dirname, so running from inside a worktree spawns that worktree's real production worker instead of an isolated one. Also found: single-instance pidfile guard doesn't detect a dead tracked PID; some leaked processes ignored SIGTERM. Corroborates track 10039 Phase 2's own self-reported finding.
**Author**: AM
**Processed**: 2026-08-30T20:37:04.138Z

### Track 10044: Board Shows queue While Lane Action Is Actively Running
**Status**: processed
**Type**: track-create
**Created**: 2026-08-30T20:05:27.000Z
**Title**: Board Shows queue While Lane Action Is Actively Running
**Description**: Live incident 2026-08-30 (tracks 10039+10040): lane actions running for 6+ minutes with live PIDs and fresh heartbeats while the Kanban showed implement:queue. Claim marker lands in the worktree copy, not the canonical primary; DB never told. Candidate cheap fix: heartbeat loop asserts lane_action_status running for runningTrackMap entries.
**Author**: AM
**Processed**: 2026-08-30T20:05:28.998Z




