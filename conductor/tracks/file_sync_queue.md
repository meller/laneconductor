

## Completed Queue

### Track 10044: Board Shows queue While Lane Action Is Actively Running
**Status**: processed
**Type**: track-create
**Created**: 2026-08-30T20:05:27.000Z
**Title**: Board Shows queue While Lane Action Is Actively Running
**Description**: Live incident 2026-08-30 (tracks 10039+10040): lane actions running for 6+ minutes with live PIDs and fresh heartbeats while the Kanban showed implement:queue. Claim marker lands in the worktree copy, not the canonical primary; DB never told. Candidate cheap fix: heartbeat loop asserts lane_action_status running for runningTrackMap entries.
**Author**: AM
**Processed**: 2026-08-30T20:05:28.998Z


