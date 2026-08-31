

## Completed Queue

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



