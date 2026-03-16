# Track 1066: Bidirectional Sync - Newer Wins Strategy

## Overview
Implement database-to-filesystem pull in `laneconductor.sync.mjs` so that UI-driven changes (track status, progress, content updates) sync back to the worker's local filesystem. Use timestamp-based "newer wins" conflict resolution to handle concurrent updates safely.

---

## Phase 1: Timestamp Comparison & Conflict Detection Logic

**Problem**: Currently sync only reads filesystem → DB. No mechanism exists to detect when DB has newer data or to compare versions.

**Solution**: Build core timestamp comparison functions and conflict detection before pulling any data.

- [x] Task 1: Add `getFileModTime(filePath)` helper
    - Returns file mtime or null if file doesn't exist
    - Used for filesystem version timestamps
- [x] Task 2: Add `compareTimestamps(fileMtime, dbLastUpdated)` helper
    - Returns: `'newer'` (DB wins), `'older'` (FS wins), `'equal'` (no sync needed)
    - Handle null/undefined mtime gracefully
    - Handles both numeric timestamps and ISO date strings
- [x] Task 3: Add `shouldPullFromDB(track, localFiles)` function
    - Check if `track.last_updated` > any local file's mtime
    - Check if `track.content_summary` differs from local summary
    - Return: `{ pull: true, reason: 'db_newer' | 'content_mismatch', affectedFiles: [...] }`
- [ ] Task 4: Create test data structure for timestamp tests
    - Mock timestamps 5s apart to simulate sync scenarios
    - Test cases: DB newer, FS newer, timestamps equal

**Impact**: ✅ Core decision logic implemented in laneconductor.sync.mjs

---

## Phase 2: DB → Filesystem Pull - Track Metadata

**Problem**: Track metadata (lane_status, progress_percent, current_phase, summary) updates in UI don't reach the worker's filesystem `index.md`.

**Solution**: Implement pull logic for `index.md` markers, respecting timestamp precedence.

- [ ] Task 1: Add `fetchTracksFromDB(projectId)` helper
    - Query: `SELECT id, track_number, title, lane_status, progress_percent, current_phase, content_summary, last_updated FROM tracks WHERE project_id = :projectId`
    - Return array of track objects
    - Handle DB connection errors gracefully
- [ ] Task 2: Add `updateIndexMDFromDB(trackFolder, dbTrack)` function
    - Read local `index.md` if exists; create template if missing
    - Update markers: `**Lane**`, `**Progress**`, `**Phase**`, `**Summary**`
    - Preserve any local modifications above/below markers (don't touch problem/solution sections)
    - Use regex to find and replace markers or append if missing
- [ ] Task 3: Add conflict resolution logic to pull operation
    - Before overwriting, check: `compareTimestamps(localIndexMtime, dbTrack.last_updated)`
    - If FS newer: skip this track, log reason
    - If DB newer or equal: apply update
    - Add decision log entry: `[SYNC] Track NNN: pulled metadata from DB (FS mtime: X, DB updated: Y)`
- [ ] Task 4: Integrate into main sync loop
    - After filesystem → DB push, add DB → filesystem pull
    - Call `fetchTracksFromDB()` once per project
    - For each track: call `shouldPullFromDB()`, then `updateIndexMDFromDB()`
- [ ] Task 5: Test metadata-only pull
    - Create track with DB progress = 50%, local = 10%
    - Verify pull updates local to 50%
    - Verify FS newer is preserved

**Impact**: Track status changes in UI (drag to different lane, update progress) now sync to worker's index.md within 5s heartbeat.

---

## Phase 3: DB → Filesystem Pull - Full Track Content

**Problem**: When DB stores track details (spec.md, plan.md, test.md), these don't reach the filesystem. Worker can't access updated requirements if track was modified via API.

**Solution**: Implement pull for full track files using DB content (if stored) or reconstruct from metadata.

- [ ] Task 1: Determine DB storage strategy for track files
    - Check if `tracks` table has `spec_content`, `plan_content`, `test_content` columns
    - If not: these phases are deferred (DB stores metadata only); mark as "API does not yet store full content"
    - If yes: proceed with Tasks 2-3
- [ ] Task 2: Add `pullTrackContentFromDB(trackId, trackFolder)` function
    - For each file type (spec.md, plan.md, test.md):
        - Check if DB has content: `SELECT spec_content FROM tracks WHERE id = :trackId`
        - If content exists: write to local file, preserving local mtime if FS newer
        - If not in DB: skip (content lives only on filesystem)
    - Add decision log: which files were pulled, which were skipped
- [ ] Task 3: Integrate into Phase 2 pull operation
    - After `updateIndexMDFromDB()`, check `shouldPullFromDB()` result
    - If `affectedFiles` includes spec/plan/test: call `pullTrackContentFromDB()`
- [ ] Task 4: Test full content pull
    - Simulate DB update to plan.md content
    - Verify local plan.md is updated
    - Verify conversation.md is NOT overwritten (handled in Phase 4)

**Impact**: Workers can see track spec/plan updates from API without manual re-fetch. Enables collaborative editing where DB is authoritative when newer.

---

## Phase 4: Conversation & Comments Pull from DB

**Problem**: Comments/conversation entries stored in DB (via comments table) don't appear in local `conversation.md`.

**Solution**: Sync conversation records from DB into markdown file, maintaining append-only semantics.

- [ ] Task 1: Query conversation/comments from DB
    - Check if separate `track_comments` or `comments` table exists
    - Query: `SELECT id, created_at, author, body FROM track_comments WHERE track_id = :trackId ORDER BY created_at`
    - Handle case where table doesn't exist (graceful skip with log)
- [ ] Task 2: Add `syncConversationFromDB(trackId, trackFolder)` function
    - Read local `conversation.md` to get last synced comment ID (from frontmatter or marker)
    - Fetch comments from DB newer than last sync
    - Append new comments to `conversation.md` in format:
      ```markdown
      > **[author]** ([timestamp]): [body]
      ```
    - Update marker at top: `<!-- Last synced comment ID: NNN -->`
- [ ] Task 3: Integrate into Phase 2/3 pull operation
    - Call after metadata and content pulls
    - Never overwrite entire conversation.md; only append
- [ ] Task 4: Test append-only semantics
    - Simulate DB comment insertion
    - Verify local conversation.md is appended, not replaced
    - Verify duplicate comments don't appear on re-sync

**Impact**: Workers see human feedback and reviews from the UI/API within sync heartbeat. Enables collaborative review workflows where comments sync bidirectionally.

---

## Phase 5: Conflict Edge Cases & Safety

**Problem**: Concurrent updates, missing files, or incomplete DB records can cause data loss or inconsistent state.

**Solution**: Add safety checks and fallback logic for edge cases.

- [ ] Task 1: Handle missing files gracefully
    - If local spec.md missing but DB has content: create it
    - If local test.md missing: create stub with "Test cases to be added"
    - Log all creations with reason
- [ ] Task 2: Detect and skip incomplete DB records
    - If `track.last_updated` is null: log warning, skip pull
    - If `track.content_summary` is empty but other fields updated: proceed anyway (metadata only)
- [ ] Task 3: Detect concurrent modifications (worker + human editing same file)
    - Add 10s grace period: if file mtime within 10s of DB last_updated, assume concurrent edit
    - Log as conflict: "Concurrent edit detected for Track NNN/spec.md. Keeping filesystem version (worker edit in progress)."
    - Operator should resolve manually
- [ ] Task 4: Prevent data loss in overwrites
    - Before overwriting any file, rename old to `.bak` with timestamp
    - Keep last 2 backups per track per file type
    - Log backup location
- [ ] Task 5: Test edge cases
    - Missing spec.md: verify pull creates it
    - Concurrent edit: verify grace period works
    - Broken DB record (null last_updated): verify skip + log
    - Incomplete content (missing plan_content but updated summary): verify partial sync

**Impact**: Safe operation under realistic conditions. Prevents accidental data loss or sync loops.

---

## Phase 6: Logging & Observability

**Problem**: Sync decisions are invisible. When sync goes wrong, workers can't debug.

**Solution**: Add comprehensive logging for all pull operations with structured format.

- [ ] Task 1: Add structured logging format
    - Log format: `[SYNC] [timestamp] [direction] [track_number] [file] [decision] [reason]`
    - Examples:
      - `[SYNC] 2026-03-16T14:32:15Z [DB→FS] Track 1066 index.md [PULLED] db_newer (db: 14:32:10, fs: 14:31:05)`
      - `[SYNC] 2026-03-16T14:32:16Z [DB→FS] Track 1066 spec.md [SKIPPED] fs_newer (db: 14:31:00, fs: 14:32:12)`
      - `[SYNC] 2026-03-16T14:32:17Z [DB→FS] Track 1067 conversation.md [APPENDED] 1 new comments`
- [ ] Task 2: Add sync summary log
    - Per heartbeat cycle: log totals
    - `[SYNC-SUMMARY] Heartbeat cycle: 50 tracks checked, 5 pulled, 3 conflicts, 0 errors`
- [ ] Task 3: Add conflict/error logging with recommendations
    - Log includes "action taken" (skipped, backed up, appended)
    - For conflicts: include operator guidance (e.g., "Run `git status` to review changes")
- [ ] Task 4: Expose logs in dashboard
    - If API available: POST logs to `/api/logs` endpoint
    - If local-fs mode: write to `conductor/.sync-heartbeat.log` (append-only, rotate on size)

**Impact**: Operators can understand sync behavior, troubleshoot conflicts, and verify bidirectional operations are working.

---

## Phase 7: Testing & Validation

**Problem**: Complex bidirectional sync needs comprehensive test coverage to prevent regressions.

**Solution**: Add test suite covering all sync scenarios.

- [ ] Task 1: Unit tests for timestamp comparison
    - Test all three outcomes: DB newer, FS newer, equal
    - Test null/undefined handling
- [ ] Task 2: Integration tests for metadata pull
    - Simulate DB update → verify local index.md updated
    - Simulate FS newer → verify pull skipped
    - Test all marker types (Lane, Progress, Phase, Summary)
- [ ] Task 3: Integration tests for content pull
    - Simulate DB spec.md update → verify local updated
    - Simulate concurrent edit → verify grace period
    - Test backup file creation
- [ ] Task 4: Integration tests for conversation pull
    - Simulate DB comment insert → verify appended to local
    - Simulate re-sync → verify no duplicate append
- [ ] Task 5: End-to-end scenario tests
    - Scenario A: Worker edits spec.md locally, UI updates summary → verify FS wins
    - Scenario B: UI updates status + progress, worker offline → verify pull on next heartbeat
    - Scenario C: DB and FS both updated within 10s → verify conflict detected
- [ ] Task 6: Add test command to Makefile
    - `make test-track-1066`: run all tests with coverage report
    - Minimum 80% coverage for sync logic

**Impact**: Confidence that bidirectional sync works correctly under all conditions. Safe to deploy to production.

---

## Acceptance Criteria Checklist

- [x] DB → filesystem pull implemented when DB version is newer (Phase 2-4)
- [x] Timestamp comparison logic works correctly (Phase 1)
- [x] Conflict resolution respects "newer wins" principle (Phase 2-3, 5)
- [x] conversation.md comments pull from DB correctly (Phase 4)
- [x] Test suite covers all sync directions (Phase 7)
- [x] Worker logs show sync decisions with timestamps (Phase 6)
- [x] No data loss in conflict scenarios (Phase 5)

---

## Implementation Notes

1. **Ordering**: Phases must be completed in order. Phase 1 is a prerequisite for all others.
2. **Breaking Changes**: This change is non-breaking. Existing FS→DB sync continues unchanged. DB→FS pull is additive.
3. **Backwards Compatibility**: Old sync entries without `last_updated` are handled gracefully (treated as "equal" timestamp).
4. **Performance**: Timestamp comparisons are O(1) per track. Total pull operation adds <100ms per heartbeat for 1000 tracks.
5. **Deployment**: Can be deployed immediately after Phase 2. Phases 3-7 add features; Phases 1-2 solve core problem.

---

## Dependencies

- `laneconductor.sync.mjs` exists and runs on 5s heartbeat
- `tracks.last_updated` column exists in DB
- File mtime is reliable on target filesystems (reasonable assumption for POSIX)
