# Track 009: Verify File Sync + Heartbeat

## Phase 1: Smoke test script

**Problem**: No way to confirm the heartbeat worker is alive without manual inspection.
**Solution**: Shell script that checks PID + DB freshness, available as `make lc-verify`.

- [x] Task 1: Write `conductor/lc-verify.sh`
    - [x] Check `conductor/.sync.pid` exists
    - [x] Check PID is alive (`kill -0 $PID`)
    - [x] Query DB: `SELECT last_heartbeat FROM tracks WHERE lane_status='in-progress' AND project_id=?`
    - [x] Report RUNNING / STALE (>10s) / STOPPED
- [x] Task 2: Add `lc-verify` target to Makefile

## Phase 2: File → DB sync verification

**Problem**: No automated confirmation that file changes propagate correctly to DB.
**Solution**: Script mutates a canary task in plan.md, waits, checks DB.

- [x] Task 1: Add canary check to `lc-verify.sh`
    - [x] Write a temp checkbox change to a test track's plan.md
    - [x] Wait up to 3s polling DB until `progress_percent` changes
    - [x] Verify `lane_status` matches ⏳/✅ markers
    - [x] Verify `phase_step` inference
    - [x] Revert the plan.md change

## Phase 3: UI polling verification

**Problem**: API response time and freshness not verified.
**Solution**: curl-based check of the API endpoint.

- [x] Task 1: Add API check to `lc-verify.sh`
    - [x] `curl` `/api/projects/:id/tracks` and measure response time
    - [x] Confirm response is < 500ms
    - [x] Confirm `last_heartbeat` in response is fresh

## Phase 4: Complete Verification Script ✅ COMPLETE

**Problem**: The `lc-verify.sh` script currently only verifies that the file content synced to the DB, but it doesn't check if inferred fields like `lane_status`, `progress_percent`, and `phase_step` are calculated correctly.
**Solution**: Enhance `lc-verify.sh` to perform a comprehensive check of all inferred fields.

- [x] Task 1: Update `lc-verify.sh` to check `lane_status` inference
- [x] Task 2: Update `lc-verify.sh` to check `progress_percent` calculation
- [x] Task 3: Update `lc-verify.sh` to check `phase_step` inference
- [x] Task 4.4: Verify `make lc-verify` passes all checks

## Phase 6: Address Review Gaps ✅ COMPLETE

**Problem**: Review (2026-02-24) identified 3 spec mismatches: heartbeat threshold was 15s vs spec's 10s, canary poll loop was 8s vs spec's 3s, and API response-time gate was informational-only vs required hard fail.
**Solution**: Corrected all three thresholds; already applied in code at time of re-run. Fixed remaining cosmetic bug (`$i/8` label).

- [x] Task 1: Confirm REQ-2 fix — `lc-verify.sh` heartbeat check now `< 10s` (matches spec)
- [x] Task 2: Confirm REQ-5 fix — canary poll loop now `{1..3}` (3s max, matches spec)
- [x] Task 3: Confirm REQ-10 fix — API endpoint check now exits non-zero if `>= 500ms`
- [x] Task 4: Fix cosmetic label `($i/8)` → `($i/3)` in progress output

## Phase 5: Quality Gate Integration ✅ COMPLETE

**Problem**: Tracks in the quality-gate lane don't have an automated action yet.
**Solution**: Implement an automated quality gate check that reads `conductor/quality-gate.md` and runs the specified checks.

- [x] Task 1: Update sync worker to handle `quality-gate` lane action
    - [x] Added `custom_prompt` to quality-gate lane config in `conductor/workflow.md` — prevents the circular review→quality-gate→review loop by explicitly instructing Claude to transition to `done` on PASS
- [x] Task 2: Create a mock quality-gate execution script
    - [x] Created `conductor/mock-quality-gate.sh` — runs syntax checks, file existence, config validation, DB connectivity, and npm audit
    - [x] Updated `conductor/quality-gate.md` to reference the script
    - [x] Added `lc-quality-gate` Makefile target
- [x] Task 3: Verify track moves to Done after quality gate passes
    - [x] Added Phase 5 quality gate section to `conductor/lc-verify.sh`
    - [x] `make lc-verify` now runs mock-quality-gate.sh and checks quality-gate lane_action_status
    - [x] `make lc-verify` passes all checks (13 quality gate checks + lane state validation)

## ✅ REVIEWED

## ✅ QUALITY PASSED
