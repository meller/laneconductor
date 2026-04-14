# Spec: Verify File Sync + Heartbeat

## Problem Statement
The heartbeat worker is always assumed to be running and syncing correctly, but there is no way to confirm this without manually editing a file and watching the UI. Failures are silent — if the worker crashes or gets out of sync, the board goes stale with no indication.

## Requirements

### Phase 1: Smoke test script
- REQ-1: Script verifies `conductor/.sync.pid` exists and the PID is alive
- REQ-2: Script queries DB and confirms `last_heartbeat` for in-progress tracks is < 10s old
- REQ-3: Script reports worker status: running / stale / stopped
- REQ-4: Available as `make lc-verify` (no LLM needed)

### Phase 2: File → DB sync
- REQ-5: Mutate a test track's `plan.md` (add/check a checkbox) and confirm DB row updates within 3s
- REQ-6: Verify `lane_status` is inferred correctly from ⏳/✅ markers
- REQ-7: Verify `progress_percent` matches actual checkbox ratio
- REQ-8: Verify `phase_step` is inferred correctly (planning/coding/complete)

### Phase 3: UI polling
- REQ-9: Confirm `/api/projects/:id/tracks` returns updated data after file change
- REQ-10: Confirm response time < 500ms

## Acceptance Criteria
- [x] `make lc-verify` prints pass/fail for each check
- [x] File change reflects in DB within 3s
- [x] Stale or stopped worker is clearly reported
- [x] All checks runnable without an LLM session
