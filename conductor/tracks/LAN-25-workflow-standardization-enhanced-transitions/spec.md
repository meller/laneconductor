# Spec: Workflow Standardization & Enhanced Transitions (Track 1020)

## Problem Statement
The current workflow configuration is fragmented. We have separate "Lanes" and "Auto Actions," and transitions only support moving to a lane (defaulting to a fixed status). Users need more flexibility to define exactly which state (lane + status) a track should land in after success or failure.

## Goals
- **Lane/Action Unification**: Standardize on a "One Name" architecture where the lane name *is* the action.
- **Enhanced Transitions**: Support `lane:status` format in `on_success` and `on_failure` fields.
- **Flexible Defaults**:
  - If target is a different lane: default status is `queue`.
  - If target is the same lane: default status is `success` (for `on_success`) or `failure` (for `on_failure`).

## Core Changes

### 1. Lane Naming (Standardized)
- `planning` → `plan`
- `in-progress` → `implement`
- `review` (unchanged)
- `quality-gate` (standardized hyphenation)

### 2. Workflow Config (`workflow.json`)
The `auto_action` field is removed. The worker infers the command from the lane name.
Transitions now support strings like `"implement:queue"` or just `"review"`.

Example:
```json
"plan": {
  "on_success": "plan:success",  // Stays in plan, marks as success
  "on_failure": "backlog:done"   // Moves to backlog, marks as done
}
```

### 3. Sync Worker Logic
The worker will parse the transition string:
- Split by `:`
- If no status provided:
  - If `targetLane === currentLane`: status = `success` (on success) or `failure` (on failure)
  - Else: status = `queue`

## Acceptance Criteria
- [ ] Worker correctly parses `lane:status` transitions.
- [ ] Tracks staying in the same lane correctly set `success` status.
- [ ] Tracks moving to new lanes correctly set `queue` status.
- [ ] `workflow.md` documentation reflects the new format.
- [ ] Tests verify multi-step transitions.
