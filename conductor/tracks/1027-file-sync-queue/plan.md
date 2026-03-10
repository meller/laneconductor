# Track 1027: File Sync Queue — Implementation Plan

## Phase 1: Rename + Message Schema Definition

**Problem**: `intake.md` lacks structure and has unclear ownership. Define the new format.

**Solution**: Create `conductor/file_sync_queue.md` with typed message structure.

**Tasks**:
- [ ] Create `conductor/file_sync_queue.md` with template structure:
  - Header: "File Sync Queue" + "Last processed" timestamp
  - "Track Creation Requests" section (copied from current intake.md)
  - "Config Sync Requests" section (empty initially)
  - "Completed Queue" section (empty initially)
- [ ] Migrate all existing entries from `conductor/tracks/intake.md` to new file:
  - Copy all pending-scaffold tracks from intake.md
  - Standardize format: `**Status**: pending`, `**Type**: track-create`, etc.
  - Preserve original descriptions
- [ ] Delete `conductor/tracks/intake.md` (contents migrated)
- [ ] Commit: `feat(track-1027): Rename intake.md → file_sync_queue.md with typed format`

**Expected Output**: `conductor/file_sync_queue.md` exists, readable by humans and machine parsers

**Impact**: Clears ambiguity about what "intake" is — now explicitly "a queue for the sync worker"

**Estimated Work**: 1-2 hours (file migration, format validation)

---

## Phase 2: Worker Processes file_sync_queue.md

**Problem**: Worker reads `.laneconductor.json` and syncs files/DB, but ignores the queue file entirely.

**Solution**: Add queue processor to `laneconductor.sync.mjs` heartbeat.

**Implementation**:

1. **Add queue parser function** in `conductor/laneconductor.sync.mjs`:
   ```javascript
   function parseFileQueue(queuePath) {
     // Read file_sync_queue.md
     // Extract entries from markdown sections
     // Return structured array of { type, title, description, status, metadata }
   }
   ```

2. **Add queue processor function**:
   ```javascript
   async function processFileQueue(entries, config) {
     for (const entry of entries) {
       if (entry.status === 'pending') {
         try {
           // Update entry status to 'processing'
           // Process based on type
           // Update status to 'processed'
         } catch (err) {
           // Set status to 'failed', log error
         }
       }
     }
   }
   ```

3. **Add handler for `type: track-create`**:
   - Generate next track number
   - Create folder: `conductor/tracks/NNN-slug/`
   - Create `index.md`, `spec.md`, `plan.md`
   - POST to API if collector configured
   - Update queue entry status

4. **Add handler for `type: config-sync`**:
   - If source is 'filesystem': PATCH API with config value
   - If source is 'database': no action (already synced)
   - Update queue entry status

5. **Integrate into heartbeat loop**:
   ```javascript
   // In main heartbeat cycle
   const queueEntries = parseFileQueue('./conductor/file_sync_queue.md');
   await processFileQueue(queueEntries, config);
   ```

**Tasks**:
- [ ] Implement `parseFileQueue()` to extract entries from markdown
- [ ] Implement `processFileQueue()` main loop
- [ ] Implement handler for `track-create` entries
- [ ] Implement handler for `config-sync` entries
- [ ] Update queue file after each successful processing
- [ ] Add error logging with entry reference
- [ ] Test locally with mock entries
- [ ] Commit: `feat(track-1027): Worker processes file_sync_queue.md`

**Expected Output**: Queue entries transition from `pending` → `processing` → `processed` automatically

**Impact**: New tracks created via queue now appear in Kanban within 1 heartbeat cycle

**Estimated Work**: 3-4 hours (parsing, API integration, error handling)

---

## Phase 3: Fix Track Creation Flow

**Problem**: Current flow:
- API directly creates DB rows for new tracks
- Skill creates track folders
- No coordination → duplicates, missing entries, sync lag

**Solution**: Make worker the ONLY creator of tracks (both folder and DB row).

**New Flow**:
1. Skill (or UI) writes to `file_sync_queue.md`: `track-create` entry
2. Worker reads queue, creates folder + DB row
3. Both are created by one system → no race conditions

**Changes**:

1. **Update `/laneconductor newTrack` skill command**:
   - Append entry to `file_sync_queue.md` (instead of creating folder immediately)
   - Status: `pending`
   - Let worker handle folder/DB creation
   - Skill returns: `"✅ Track queued in file_sync_queue.md. Worker will create folder in next cycle."`

2. **Update API `/api/tracks/new` endpoint** (if it exists):
   - Write to queue file (if local mode)
   - Return `"✅ Track queued"`
   - Do NOT directly create DB row

3. **Disable direct DB creation**:
   - Remove any `INSERT INTO tracks` calls triggered by `newTrack`
   - All track creation now flows through queue → worker

4. **Remove old `intake.md` handling**:
   - Grep for references to `intake.md`
   - Update all skill commands to use `file_sync_queue.md`

**Tasks**:
- [ ] Update skill command `/laneconductor newTrack` to write to `file_sync_queue.md`
- [ ] Update API endpoint (if exists) to use queue instead of direct DB insert
- [ ] Remove direct `INSERT INTO tracks` from new-track flows
- [ ] Update SKILL.md docs for newTrack command
- [ ] Test: Create track via skill → verify appears in queue → worker creates it
- [ ] Commit: `feat(track-1027): Fix track creation flow to use queue`

**Expected Output**: All track creation routes through worker, no race conditions

**Impact**: `/laneconductor newTrack` now has predictable 5-10s latency (1 heartbeat) instead of instant

**Breaking Changes**: Users must wait for worker to process queue (explain in docs)

**Estimated Work**: 2-3 hours (skill updates, API refactor, testing)

---

## Phase 4: Config Sync Bidirectional

**Problem**: `.laneconductor.json` changes don't sync to DB, and DB changes don't reach files.

**Solution**: Add `config-sync` entries to queue for bidirectional propagation.

**Implementation**:

1. **File → DB sync** (worker processor already started in Phase 2):
   - Entry type: `config-sync`, source: `filesystem`
   - Worker reads `.laneconductor.json`, compares with last-known DB state
   - PATCH API if different: `/api/projects/:id/config { key, value }`
   - Mark entry processed

2. **DB → File sync** (new logic):
   - When API receives config PATCH, generate `config-sync` entry with source: `database`
   - Write to queue file
   - Worker sees it, updates local file, marks processed
   - Alternative: Worker polls DB periodically and generates entries if config changed

3. **Add to worker initialization**:
   - On startup, compare `.laneconductor.json` with DB config
   - If different, generate `config-sync` entries and process them

**Tasks**:
- [ ] Implement DB → file config sync:
  - Add logic to detect DB config changes
  - Generate `config-sync` entries in queue
  - Worker reads and applies to `.laneconductor.json`
- [ ] Implement file → DB sync:
  - Detect `.laneconductor.json` changes (via chokidar or heartbeat comparison)
  - Generate `config-sync` entries
  - Worker PATCHes API
- [ ] Prevent infinite loops:
  - Track timestamps to avoid re-syncing same change
  - Use "newer wins" strategy (compare file mtime vs last-sync-time)
- [ ] Test: Edit `.laneconductor.json` → verify syncs to DB within 1 heartbeat
- [ ] Test: Change config in UI/DB → verify syncs to `.laneconductor.json`
- [ ] Commit: `feat(track-1027): Bidirectional config sync via queue`

**Expected Output**: Config changes automatically sync in both directions

**Impact**: Multi-machine projects can now safely edit config from UI and have it reach all workers

**Estimated Work**: 2-3 hours (conflict resolution, tests)

---

## Phase 5: Fix Worktree Artifact Copy (Bug — surfaced during planning)

**Problem**: Two bugs discovered when track 1027 was auto-planned:

1. **Artifact copy replaces index.md** — `[worktree] Copied artifacts to main repo` overwrites the full index.md with whatever the planning agent wrote (often a bare one-liner like `**Lane Status**: success`). It should merge status markers into the existing file, not replace it.
2. **Planning agent writes bare index.md** — the auto-plan agent should preserve all existing content in index.md and only update the `**Lane**`, `**Lane Status**`, `**Progress**`, `**Phase**`, `**Summary**` markers in-place. Writing a new minimal file loses the Problem/Solution/Phases content.

**Solution**:
- `copyArtifacts()` in sync worker: instead of overwriting index.md, parse the artifact for markers and apply them onto the existing file (same regex-replace approach used elsewhere)
- Planning agent instructions in SKILL.md: explicitly say "update markers in-place, never replace the whole index.md"

- [ ] Task 1: Fix `copyArtifacts()` in `laneconductor.sync.mjs`
    - [ ] For `index.md` specifically: read existing file, extract markers from artifact, apply only markers via regex replace, write merged result
    - [ ] For `plan.md`, `spec.md`: full replace is fine (agent owns these entirely)
- [ ] Task 2: Add note to SKILL.md planning agent instructions: preserve index.md content, only update status markers

**Impact**: No more disappearing index.md content after auto-plan runs. Race conditions between human edits and artifact copies are safe.

---

## Phase 6: Update SKILL.md + Tests

**Problem**: SKILL.md documents old `newTrack` flow and doesn't mention queue processing.

**Solution**: Update documentation and add comprehensive tests.

**Documentation Changes**:

1. **Update `/laneconductor newTrack` docs in SKILL.md**:
   ```markdown
   ### `/laneconductor newTrack [name] [description]`

   Registers a new track in the **file sync queue**. The sync worker processes it on next heartbeat.

   **Flow**:
   1. Appends entry to `conductor/file_sync_queue.md` with status `pending`
   2. Sync worker detects change (5-10s typical latency)
   3. Creates folder: `conductor/tracks/NNN-slug/`
   4. Creates DB row via API
   5. Moves entry to "Completed Queue"

   **Important**: Track creation is **async** — allow ~5-10 seconds for folder to appear.
   ```

2. **Add new section**: "File Sync Queue Protocol"
   - Explain queue structure
   - Document entry types (track-create, config-sync)
   - Explain worker behavior
   - Show examples

3. **Update "Filesystem-as-API" section**:
   - Mention queue as a sync interface
   - Explain when to edit queue vs. when worker edits it

**Test Cases**:

1. **Unit Tests** (`conductor/tests/queue-processor.test.mjs`):
   - ✅ Parse valid queue file with mixed entry types
   - ✅ Extract track creation requests correctly
   - ✅ Handle malformed entries gracefully
   - ✅ Generate valid track numbers (no conflicts)
   - ✅ Create track folder with correct structure
   - ✅ Update queue entry status correctly

2. **Integration Tests** (`conductor/tests/local-api-e2e.test.mjs`):
   - ✅ `/laneconductor newTrack` → entry in queue → folder created by worker
   - ✅ Queue entry transitions: pending → processing → processed
   - ✅ Created track appears in DB within 1 heartbeat
   - ✅ Config sync: file → DB, then DB → file
   - ✅ Failed queue entry (invalid metadata) stays in pending state
   - ✅ Multiple queue entries processed in single heartbeat cycle

3. **E2E Tests** (maybe Playwright later):
   - ✅ Create track via skill → appears in Kanban within 5s
   - ✅ Create track via UI → folder appears in `conductor/tracks/`
   - ✅ Modify config → syncs to all places

**Tasks**:
- [ ] Update SKILL.md with new `/laneconductor newTrack` behavior
- [ ] Add "File Sync Queue Protocol" section to SKILL.md
- [ ] Create `conductor/tests/queue-processor.test.mjs` with unit tests
- [ ] Add integration tests to `conductor/tests/local-api-e2e.test.mjs`
- [ ] Update product.md to mention queue architecture
- [ ] Update README with async track creation behavior
- [ ] Run all tests, verify passing
- [ ] Commit: `docs(track-1027): Update SKILL.md, product.md, add comprehensive tests`

**Expected Output**: SKILL.md fully documents queue, tests prove everything works

**Estimated Work**: 2-3 hours (docs + testing)

---

## ✅ COMPLETE

Track 1027 implementation transforms the intake process:
- **Before**: Ambiguous `intake.md`, unprocessed entries, race conditions
- **After**: Typed queue, worker-driven creation, clear separation of concerns

**Benefits**:
✅ New tracks appear reliably in Kanban
✅ No more duplicate DB rows or missed folders
✅ Config syncs bidirectionally
✅ Clear queue lifecycle for debugging
✅ Audit trail in "Completed Queue" section
✅ Extensible to other message types in future
\n## ✅ REVIEWED

## ✅ QUALITY PASSED
