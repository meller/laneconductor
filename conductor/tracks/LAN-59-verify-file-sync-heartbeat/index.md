# Track 009: Verify File Sync + Heartbeat

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
The heartbeat worker (`laneconductor.sync.mjs`) is the critical bridge between markdown files and the Postgres DB. There is no automated way to verify it is running correctly, that file changes propagate to the DB as expected, and that the UI reflects updates within the expected time window.

## Solution
A verification suite (script + manual checklist) that confirms the full heartbeat pipeline: file change → watcher fires → DB upsert → UI poll picks it up. Covers startup, file sync, progress parsing, lane status inference, and the phase_step calculation.

## Phases
- [x] Phase 1: Heartbeat smoke test script
- [x] Phase 2: File → DB sync verification
- [x] Phase 3: UI polling verification
- [x] Phase 4: Complete Verification Script
- [x] Phase 5: Quality Gate Integration
