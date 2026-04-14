# Track 1006: Workflow Logic (Retry & Transitions)

**Status**: done
**Progress**: 100%

## Problem
Currently, track transitions and retries are largely hardcoded. In multi-tenant/remote environments, the UI cannot write to local configuration files, so the automation logic must rely on the local `workflow.md` as the source of truth for execution flow.

## Solution
Update the **LaneConductor Sync Worker** to respect per-lane configuration defined in the local `workflow.md`. This allows users to manually adjust retries, success paths, and failure behaviors in their repository.

---

## Phase 1: Refined Execution Logic (Sync Worker) ✅
- [x] Task 1.1: Load `workflow.md` config in `laneconductor.sync.mjs`.
- [x] Task 1.2: Implement `max_retries` logic — stop and block tracks after configured attempts.
- [x] Task 1.3: Implement `on_success` routing — move track to specific lane upon exit 0.
- [x] Task 1.4: Implement `on_failure` routing — move to specific lane (e.g., backlog) if retries exhausted.

## Phase 2: Workflow Configuration UI ✅
- [x] Task 2.1: Implement read-only view of workflow in UI.
- [x] Task 2.2: Implement JSON editor for workflow in UI.
- [x] Task 2.3: Implement API endpoints for reading/writing `workflow.md`.

## Phase 3: Verification (Manual Config) ✅
- [x] Task 3.1: Verify worker blocks track after configured failures.
- [x] Task 3.2: Verify `on_success` jumps to the correct lane.
- [x] Task 3.3: Verify manual retry (bypass) logic.

---

## What Does NOT Change
- Multi-tenant architecture: Workers remain the authority on local repo execution.
- Collector role: Remains a passive data receiver/orchestrator.

## ✅ REVIEWED
