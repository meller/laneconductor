# Spec: File Sync Queue — Filesystem Message Bus

## Overview

Track 1027 establishes `file_sync_queue.md` as a **typed message queue** — the filesystem-side counterpart to the `file_sync_queue` table in the database. The sync worker becomes the sole consumer, processing pending entries to create tracks, sync config changes, and manage queue lifecycle. This creates a clear separation of concerns across all conductor files.

## Current Problem

1. **`intake.md` is ambiguous**: Both API and skill write to it, but the worker ignores it entirely
2. **New tracks don't sync**: When `/laneconductor newTrack` creates an entry in `intake.md`, it never becomes a DB row or track folder
3. **Config changes aren't bidirectional**: Edits in `.laneconductor.json` don't propagate to the database, and DB changes don't reach the filesystem
4. **No queue lifecycle management**: Entries have status `pending-scaffold` but nothing consumes or cleans them up
5. **Source-of-truth ambiguity**: Is the DB or filesystem authoritative? For queued work, it's unclear

## Solution Design

### 1. File Format: `conductor/file_sync_queue.md`

Rename `conductor/tracks/intake.md` → `conductor/file_sync_queue.md` and establish a typed message format:

```markdown
# File Sync Queue

Last processed: 2026-03-05T12:00:00Z

## Track Creation Requests

### Track 1027: File Sync Queue — Filesystem Message Bus
**Status**: pending
**Type**: track-create
**Created**: 2026-03-05T12:00:00Z
**Title**: File Sync Queue — Filesystem Message Bus
**Description**: Rename intake.md to file_sync_queue.md and implement it as a proper typed message queue...
**Metadata**: { "priority": "high", "assignee": null }

### Track 1028: E2E Test 1772624828336
**Status**: pending
**Type**: track-create
**Created**: 2026-03-05T11:55:00Z
**Title**: E2E Test 1772624828336
**Description**: Automated Playwright e2e — verifies new track flows to worker and back
**Metadata**: { "priority": "medium", "assignee": null }

## Config Sync Requests

### Request: Update .laneconductor.json mode
**Status**: pending
**Type**: config-sync
**Created**: 2026-03-05T10:30:00Z
**Key**: mode
**Value**: "local-api"
**Source**: filesystem (user edited directly)

## Completed Queue

*Entries move here after successful processing and cleanup*

### Track 001: Initial Setup
**Status**: processed
**Type**: track-create
**Processed**: 2026-02-27T14:00:00Z
```

### 2. Message Types

**Type: `track-create`**
- Creates a new track folder and DB row
- Consumes a `Title` and `Description` from the queue entry
- Worker creates `conductor/tracks/NNN-slug/{index.md, spec.md, plan.md}`
- Generates DB row via API `POST /tracks`
- Moves entry to "Completed Queue" with status `processed`

**Type: `config-sync`**
- Bidirectional config change
- If `Source: filesystem` → worker syncs to DB
- If `Source: database` → already in files via worker, no action needed
- Moves entry to "Completed Queue"

### 3. Entry Lifecycle

Each entry has a `Status`:
- `pending` — waiting for worker to process
- `processing` — worker is actively handling it
- `processed` — completed successfully
- `failed` — error occurred (logged with reason)
- `archived` — moved to completed section after N days

## Worker Behavior

### Poll Interval
- Worker checks `file_sync_queue.md` every 5 seconds (same heartbeat)
- File modification time (`mtime`) triggers immediate re-read

### Processing Logic

**For each entry in "Track Creation Requests" with Status: `pending`**:

1. Update entry: `Status: processing`
2. Parse `Title` and `Description`
3. Generate track number (highest existing + 1)
4. Create track folder: `conductor/tracks/NNN-slug/`
5. Generate slug from Title
6. Create `index.md` with:
   ```markdown
   # Track NNN: Title

   **Lane**: planning
   **Lane Status**: waiting
   **Progress**: 0%
   **Phase**: Planning
   **Summary**: Description (first 100 chars)

   ## Problem
   [Description]

   ## Solution
   [Empty — awaiting scaffolding]

   ## Phases
   - [ ] Phase 1: Planning
   ```
7. Create stub `spec.md` and `plan.md`
8. Commit: `feat(track-NNN): Created from file_sync_queue`
9. POST to API: `POST /api/projects/:id/tracks { track_number, title, lane_status: 'planning' }`
10. Move entry to "Completed Queue": Update Status to `processed`, add `Processed: <timestamp>`
11. Commit: `feat(queue): Processed track-create for NNN`

**For each entry in "Config Sync Requests" with Status: `pending`**:

1. Update entry: `Status: processing`
2. If `Source: filesystem`:
   - Read key from `.laneconductor.json`
   - PATCH API: `/api/projects/:id/config { key, value }`
3. If `Source: database`:
   - (No action — already reflected in files)
4. Move entry to "Completed Queue" with status `processed`
5. Commit

### Error Handling

- If track creation fails (invalid metadata): Set entry `Status: failed`, log reason
- If API call fails: Keep `Status: processing`, retry next cycle
- If git commit fails: Log but continue (next cycle will retry)

## Files to Create/Modify

**Create**:
- `conductor/file_sync_queue.md` — new queue file (rename from intake.md)

**Modify**:
- `conductor/laneconductor.sync.mjs` — add queue processor logic
- `.claude/skills/laneconductor/SKILL.md` — update `/laneconductor newTrack` docs to reference queue
- `conductor/tests/local-api-e2e.test.mjs` — add tests for queue processing

**Remove**:
- `conductor/tracks/intake.md` (contents migrated to `file_sync_queue.md`)

## Success Criteria

✅ `file_sync_queue.md` exists with typed message format
✅ Worker processes `track-create` entries (folder creation + DB row)
✅ Worker processes `config-sync` entries bidirectionally
✅ Queue entries have clear lifecycle (pending → processing → processed)
✅ New tracks appear in Kanban within 1 heartbeat cycle
✅ Config changes sync from file → DB within 1 heartbeat cycle
✅ SKILL.md documents the new queue format
✅ Integration tests verify end-to-end queue processing
✅ All existing "pending-scaffold" entries migrate cleanly

## Key Design Decisions

1. **Rename over parallel files**: Use `file_sync_queue.md` (not `intake.md` alongside)
   - Rationale: Single source of truth for intake
   - Clear intent: "this is a queue for the sync worker"

2. **Worker is sole consumer**: API writes entries, worker processes them
   - Rationale: Prevents race conditions, clear lifecycle
   - Alternative rejected: API directly creating folders (violates filesystem-as-source)

3. **Completed Queue section**: Processed entries stay for audit trail
   - Rationale: Post-mortem debugging, understanding what was automated
   - Alternative rejected: Delete after processing (less traceable)

4. **Metadata field**: Optional JSON for future extensibility
   - Rationale: Priority, assignee, tags can be added later
   - Current usage: Empty or minimal

5. **Status enum**: Simple string values (not complex states)
   - Rationale: Human-readable, easy to query/grep
   - Values: pending, processing, processed, failed, archived
