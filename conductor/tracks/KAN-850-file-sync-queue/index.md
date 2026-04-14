# Track 1027: File Sync Queue — Filesystem Message Bus

**Lane**: done
**Lane Status**: success
**Progress**: 0%
**Phase**: Complete
**Summary**: Rename intake.md to file_sync_queue.md and implement it as the filesystem-side message bus, symmetric counterpart to the DB file_sync_queue table

## Problem
Currently, the intake flow is ambiguous and new tracks created via the skill or API don't sync reliably to the DB. This track establishes `file_sync_queue.md` as the authoritative source for new work intake and ensures bidirectional config sync.

## Solution
1. Rename `intake.md` → `file_sync_queue.md`.
2. Implement typed message parsing in the worker.
3. Handle `track-create` and `config-sync` message types.
4. Add lifecycle management (pending → processing → processed).

## Phases
- [x] Phase 1: Rename + message schema
- [x] Phase 2: Worker processes file_sync_queue.md
- [x] Phase 3: Fix track creation flow
- [x] Phase 4: Config sync bidirectional
- [x] Phase 5: Fix worktree artifact copy (index.md merge not replace)
- [x] Phase 6: Update SKILL.md + tests
Update SKILL.md + tests
