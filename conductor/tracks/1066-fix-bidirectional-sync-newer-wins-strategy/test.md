# Tests: Track 1066 — Bidirectional Sync with Newer Wins Strategy

## Test Commands

```bash
# Run all tests for sync module
npm test -- conductor/tests/sync.test.mjs

# Run specific test suite
npm test -- conductor/tests/sync.test.mjs --grep "Phase 1"

# Run with coverage
npm test -- conductor/tests/sync.test.mjs --coverage
```

## Test Cases

### Phase 1: Timestamp Comparison & Conflict Detection

- [ ] TC-1.1: `getFileModTime()` returns mtime for existing file
  - Input: path to existing file
  - Expected: returns numeric timestamp in milliseconds
- [ ] TC-1.2: `getFileModTime()` returns null for missing file
  - Input: path to non-existent file
  - Expected: returns null (no error)
- [ ] TC-1.3: `compareTimestamps()` returns 'newer' when DB is newer
  - Input: fileMtime = 1000, dbLastUpdated = 2000
  - Expected: 'newer'
- [ ] TC-1.4: `compareTimestamps()` returns 'older' when FS is newer
  - Input: fileMtime = 3000, dbLastUpdated = 2000
  - Expected: 'older'
- [ ] TC-1.5: `compareTimestamps()` returns 'equal' when timestamps match
  - Input: fileMtime = 2000, dbLastUpdated = 2000
  - Expected: 'equal'
- [ ] TC-1.6: `compareTimestamps()` handles null fileMtime gracefully
  - Input: fileMtime = null, dbLastUpdated = 2000
  - Expected: 'newer' (treat missing as older)
- [ ] TC-1.7: `shouldPullFromDB()` detects DB newer scenario
  - Input: track with newer last_updated, local files older
  - Expected: `{ pull: true, reason: 'db_newer', affectedFiles: [...] }`
- [ ] TC-1.8: `shouldPullFromDB()` skips when FS is newer
  - Input: track with older last_updated, local files newer
  - Expected: `{ pull: false }`

### Phase 2: Metadata Pull

- [ ] TC-2.1: `fetchTracksFromDB()` returns tracks array
  - Expected: array with track_number, title, lane_status, progress_percent, content_summary, last_updated
- [ ] TC-2.2: `updateIndexMDFromDB()` updates Lane marker
  - Input: dbTrack with lane_status = 'review'
  - Expected: index.md has `**Lane**: review`
- [ ] TC-2.3: `updateIndexMDFromDB()` updates Progress marker
  - Input: dbTrack with progress_percent = 50
  - Expected: index.md has `**Progress**: 50%`
- [ ] TC-2.4: `updateIndexMDFromDB()` respects filesystem newer
  - Input: local file newer than DB
  - Expected: no update, logged reason
- [ ] TC-2.5: Metadata pull honors timestamp comparison
  - Setup: DB updated 1s ago, local file updated 10s ago
  - Expected: pull skipped, FS version preserved

### Phase 3: Content Pull

- [ ] TC-3.1: `pullTrackContentFromDB()` creates missing files
  - Input: DB has spec_content, local spec.md missing
  - Expected: spec.md created with DB content
- [ ] TC-3.2: Content pull respects timestamp precedence
  - Input: DB content newer, local file older
  - Expected: local file updated with DB content
- [ ] TC-3.3: Backup created before overwrite
  - Input: local plan.md will be overwritten
  - Expected: plan.md.bak created with timestamp

### Phase 4: Conversation Sync

- [ ] TC-4.1: Comments appended, not replaced
  - Setup: local conversation.md has 2 comments, DB has 3
  - Expected: 1 new comment appended to local
- [ ] TC-4.2: No duplicate comments on re-sync
  - Setup: re-sync same DB comment
  - Expected: comment not duplicated
- [ ] TC-4.3: Last synced ID tracked
  - Expected: conversation.md has `<!-- Last synced comment ID: NNN -->`

### Phase 5: Edge Cases & Safety

- [ ] TC-5.1: Missing test.md creates stub
  - Input: local test.md missing, DB has newer content
  - Expected: stub created with placeholder text
- [ ] TC-5.2: Null last_updated skips pull
  - Input: track.last_updated = null
  - Expected: pull skipped, warning logged
- [ ] TC-5.3: Concurrent edit grace period (10s)
  - Input: file mtime within 10s of DB last_updated
  - Expected: pull skipped, conflict logged
- [ ] TC-5.4: Multiple backups maintained
  - Setup: file overwritten 3 times
  - Expected: only 2 backups kept, oldest deleted
- [ ] TC-5.5: Backup cleanup works
  - Input: 3+ .bak files
  - Expected: oldest removed, max 2 kept

### Phase 6: Logging

- [ ] TC-6.1: Sync decision logged with timestamps
  - Expected: `[SYNC] [ISO timestamp] [direction] [track] [file] [decision]`
- [ ] TC-6.2: Summary log per heartbeat
  - Expected: `[SYNC-SUMMARY] X tracks checked, Y pulled, Z conflicts`
- [ ] TC-6.3: Conflict logging includes guidance
  - Expected: log includes action taken + operator recommendation

### Phase 7: Integration

- [ ] TC-7.1: DB→FS pull integrated into main sync loop
  - Expected: pull happens after FS→DB push in same heartbeat
- [ ] TC-7.2: No data loss in conflict scenarios
  - Setup: concurrent edits on same file
  - Expected: both versions backed up, worker version preserved

## Acceptance Criteria

- [ ] All Phase 1 tests pass (timestamp logic)
- [ ] All Phase 2 tests pass (metadata sync)
- [ ] All Phase 3 tests pass (content sync)
- [ ] All Phase 4 tests pass (comments sync)
- [ ] All Phase 5 tests pass (edge cases)
- [ ] Sync log output is structured and parseable
- [ ] No test data left on filesystem after tests
- [ ] 80%+ code coverage for sync logic
- [ ] No data loss in any tested scenario
- [ ] Concurrent edit scenarios handled safely
