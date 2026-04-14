# Spec: Lane Status Enum Implementation

## Problem Statement
Currently, `lane_action_status` in the database uses ad-hoc string values ("waiting", "running", "done") without type safety or clear semantics. This makes the system fragile and unclear about valid state transitions. We need a proper enum to define allowed values and improve clarity across the codebase.

## Requirements
- REQ-1: Define `LaneActionStatus` enum with values: `queue`, `success`, `failure`
- REQ-2: Update Prisma schema to use enum type instead of String
- REQ-3: Create Atlas migration to alter the database column
- REQ-4: Update worker code to parse and use enum values from markdown
- REQ-5: Update UI to display and interpret enum states
- REQ-6: Update workflow.md with lane state machine documentation
- REQ-7: All track markdown files use proper enum values in `**Lane Status**` field

## Acceptance Criteria
- [ ] Prisma schema defines LaneActionStatus enum with (queue, success, failure)
- [ ] Database migration successfully alters lane_action_status column type
- [ ] Worker parses **Lane Status** from markdown and syncs enum values
- [ ] UI displays correct state badges/colors based on enum values
- [ ] All existing tracks updated to use new enum values
- [ ] workflow.md documents the lane state machine with enum values
- [ ] No migrations or rebuilds required; existing data maps cleanly

## Mapping Old → New
- `waiting` → `queue` (track waiting to be processed)
- `running` → `queue` (no direct mapping; still active)
- `done` → `success` (track work completed successfully)
- (new) `failure` (track work failed/blocked)

## Data Models

```typescript
enum LaneActionStatus {
  queue = "queue"       // Waiting for worker to process
  success = "success"   // Work completed successfully
  failure = "failure"   // Work failed or blocked
}
```

Prisma:
```prisma
model tracks {
  ...
  lane_action_status  LaneActionStatus  @default(queue)
  ...
}
```
