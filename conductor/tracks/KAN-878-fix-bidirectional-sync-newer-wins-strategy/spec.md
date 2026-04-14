# Spec: Bidirectional Sync with "Newer Wins" Conflict Resolution

## Problem Statement
LaneConductor currently syncs changes one-way: filesystem → database. When DB values are updated (e.g., track lane status changed via UI), those changes don't reach the worker's local filesystem. This breaks the "filesystem as source of truth" principle and prevents the worker from seeing UI-driven changes.

## Requirements
- REQ-1: Detect when DB track metadata (`last_updated`, `content_summary`) is newer than local files
- REQ-2: Pull full track details (spec.md, plan.md, test.md, conversation.md) from DB when DB is newer
- REQ-3: Use timestamp-based "newer wins" conflict resolution (file mtime vs DB last_updated)
- REQ-4: Sync bidirectionally (filesystem → DB and DB → filesystem)
- REQ-5: Preserve local changes when filesystem is newer
- REQ-6: Handle edge cases: missing files, incomplete DB records, concurrent updates
- REQ-7: Log all sync decisions (which version won and why)

## Acceptance Criteria
- [ ] DB → filesystem pull implemented when DB version is newer
- [ ] Timestamp comparison logic works correctly
- [ ] Conflict resolution respects "newer wins" principle
- [ ] conversation.md comments pull from DB correctly
- [ ] Test suite covers all sync directions (FS→DB, DB→FS, conflicts)
- [ ] Worker logs show sync decisions with timestamps
- [ ] No data loss in conflict scenarios

## Data Model Changes
No new fields required. Uses existing:
- `tracks.last_updated` (timestamp when DB record modified)
- `tracks.content_summary` (summary pulled from plan.md)
- File modification time (mtime) on local files
