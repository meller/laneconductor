# Track 1036: Worktree Lock Manager — Implementation Plan

## Phase 1: Lock Status Visibility (CLI)

**Goal**: Build `lc locks` command to show all locked tracks in the current project.

**Tasks**:
- [x] Create `conductor/lock-status.mjs` module that queries `.conductor/locks/` and reads lock files
- [x] Parse each lock file JSON and compute lock age (now - started_at)
- [x] Implement `lc locks` command (entry point in CLI dispatcher)
- [x] Format output as ASCII table: track | owner | started_at | age | status
- [x] Add `--stale` flag to filter only locks >5 minutes old
- [x] Add `--json` flag for JSON output (for programmatic use)
- [x] Test with 2-3 manually created lock files

**Exit Criteria**:
- `lc locks` displays all locks with human-readable ages
- `lc locks --stale` shows only stale locks with red warnings
- JSON output is parseable by API clients

---

## Phase 2: Lock Status Visibility (Postgres Schema + Worker Sync)

**Goal**: Persist lock metadata to Postgres and enable UI polling.

**Tasks**:
- [x] Add `track_locks` table to Postgres schema (if not already present):
  ```sql
  CREATE TABLE IF NOT EXISTS track_locks (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    track_number TEXT NOT NULL,
    owner_user TEXT,
    owner_machine TEXT,
    owner_cli TEXT,
    started_at TIMESTAMP,
    worktree_path TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, track_number)
  );
  ```
- [x] Modify `conductor/laneconductor.sync.mjs` to watch `.conductor/locks/` folder
- [x] On lock file change/creation, parse and UPSERT into `track_locks` table
- [x] On lock file deletion, DELETE from `track_locks` table
- [x] Handle stale lock detection: mark `status = 'stale'` if lock_age > 5 minutes
- [x] Run migration: `atlas migrate dev` to apply schema changes
- [x] Test sync: create/modify lock file, verify Postgres row within 5 seconds

**Exit Criteria**:
- Postgres `track_locks` table exists and is in sync with `.conductor/locks/`
- Worker syncs lock files with <5s latency
- Stale locks are flagged in DB

---

## Phase 3: Lock Status Visibility (Kanban UI)

**Goal**: Display lock indicators on track cards in the Vite dashboard.

**Tasks**:
- [x] In `ui/src/components/TrackCard.tsx`, add lock icon indicator (🔒)
- [x] Fetch lock status from API: `GET /api/projects/:id/tracks/:track/lock`
- [x] Show tooltip on lock icon with:
  - Track number
  - Owner (user + machine)
  - Lock age (human readable)
  - Force unlock button (with confirmation)
- [x] Add red background / badge if lock is stale (>5 minutes)
- [x] Style locked cards to be visually distinct (greyed out or dim)
- [x] Implement tooltip component (react-tooltip or custom)
- [x] Test lock icon appears when lock file exists

**Exit Criteria**:
- Lock icons appear on all locked tracks
- Tooltips show correct metadata
- Stale locks are visually distinct
- Manual unlock button is accessible (but hidden until Phase 4)

---

## Phase 4: Unlock with Merge

**Goal**: Implement `lc unlock NNN` command that safely merges worktree and removes lock.

**Tasks**:
- [x] Create `conductor/commands/unlock.mjs` module
- [x] **Sub-task**: Check if lock exists and belongs to current worker/machine
  - Read `.conductor/locks/{track}.lock`
  - Verify ownership (or allow override with `--force` flag)
- [x] **Sub-task**: Merge worktree branch to main
  - `git worktree list` to find the worktree path
  - `git -C {worktree_path} add .`
  - `git -C {worktree_path} commit -m "feat(track-NNN): Worktree merge"` (if changes exist)
  - `git checkout main && git merge {track-branch} --no-edit`
  - Handle merge conflicts (prompt user or auto-resolve)
- [x] **Sub-task**: Remove worktree and lock
  - `git worktree remove {worktree_path}`
  - `rm .conductor/locks/{track}.lock`
  - `git add .conductor/locks/{track}.lock && git commit -m "chore: Release lock for track NNN"`
- [x] **Sub-task**: Update track metadata
  - Read `conductor/tracks/NNN-*/index.md`
  - Update `**Lane Status**: success` (merge succeeded) or `queue` (merge failed)
  - Append log to `conversation.md`: "🔓 Unlocked and merged by {user} at {timestamp}"
- [x] Implement `lc unlock NNN` CLI command
- [x] Add error handling: stale lock, missing worktree, merge conflicts
- [x] Test with real track (manually create a lock and worktree, then unlock)

**Exit Criteria**:
- `lc unlock NNN` successfully merges and removes lock
- Track lane is unchanged after unlock
- Lock metadata is logged to `conversation.md`
- Merge conflicts are handled gracefully
- Stale locks can be unlocked with confirmation

---

## Phase 5: Force Unlock (No Merge)

**Goal**: Implement `lc unlock NNN --force` to discard work and remove lock.

**Tasks**:
- [x] Add `--force` / `--no-merge` flag to `conductor/commands/unlock.mjs`
- [x] **Sub-task**: Skip merge logic entirely
  - Do NOT run `git merge`
  - Simply discard worktree contents
- [x] **Sub-task**: Remove worktree and lock
  - `git worktree remove --force {worktree_path}` (ignores dirty state)
  - `rm .conductor/locks/{track}.lock`
  - `git add .conductor/locks/{track}.lock && git commit -m "chore: Force-released lock for track NNN"`
- [x] **Sub-task**: Update track metadata
  - Update `**Lane Status**: queue` (ready to retry)
  - Append log to `conversation.md`: "🔓❌ Force-unlocked (work discarded) by {user} at {timestamp}"
- [x] UI confirmation dialog: "This will discard all work in this track's worktree. Continue?"
- [x] Add to Kanban UI: "Force Unlock" button in lock tooltip (with red styling)
- [x] Test force-unlock with a track containing uncommitted changes

**Exit Criteria**:
- `lc unlock NNN --force` discards work and removes lock
- UI shows confirmation dialog before force-unlock
- Track is set to `queue` status (ready to retry)
- Force-unlock is logged with clear messaging

---

## Phase 6: Stale Lock Auto-Cleanup

**Goal**: Automatically detect and clean up stale locks (>5 minutes).

**Tasks**:
- [x] Modify `/laneconductor lock` and `/laneconductor implement` to run stale detection
- [x] **Sub-task**: Implement stale detection logic
  - Check all lock files in `.conductor/locks/`
  - Calculate age: now - started_at
  - If age > 5 minutes, mark as stale
- [x] **Sub-task**: Auto-cleanup handler
  - Prompt user: "Found 1 stale lock for track NNN (5m 30s old). Remove? (y/n)"
  - If yes: call force-unlock logic, log action
  - If no: proceed anyway but emit warning
- [x] Add `--cleanup` flag: `lc locks --cleanup` to force cleanup all stale locks at once
- [x] Integrate stale detection into worker heartbeat (`laneconductor.sync.mjs`)
  - Check every heartbeat cycle (5s)
  - Auto-flag stale locks in Postgres `track_locks` table (status='stale')
- [x] Test: manually create an old lock file, verify auto-cleanup prompt

**Exit Criteria**:
- Stale locks are auto-detected on each lock/implement call
- User can interactively confirm cleanup or override
- Worker marks stale locks in Postgres
- Cleanup action is logged

---

## Phase 7: Lock Metadata Persistence & Git Audit Trail

**Goal**: Ensure all lock operations are persisted and auditable.

**Tasks**:
- [x] Define lock JSON schema in `.conductor/locks/{track}.lock`:
  ```json
  {
    "track_number": "1036",
    "owner": {
      "user": "claude-code",
      "machine": "ubuntu-laptop",
      "cli": "claude",
      "pattern": "implement"
    },
    "started_at": "2026-03-06T14:32:00Z",
    "worktree_path": ".git/worktrees/1036/",
    "branch": "track-1036-worktree-lock-manager",
    "status": "active"
  }
  ```
- [x] Lock files are always committed to git (no .gitignore)
- [x] All unlock actions produce commits: "chore: Release lock for track NNN"
- [x] Create `conductor/lock-history.md` (or append to `conversation.md`):
  - Log: who locked / unlocked, when, reason (merge / force-unlock)
  - Readable by humans via `git log --grep="lock"`
- [x] Test git audit trail: create 3 locks/unlocks, verify commit history

**Exit Criteria**:
- Lock files are properly formatted JSON
- All locks committed to git
- Unlock operations produce clear git commits
- Lock history is auditable via git log or conversation.md

---

## Phase 8: Integration & Testing

**Goal**: End-to-end testing of entire lock lifecycle.

**Tasks**:
- [x] **E2E Test**: Parallel workers lock same track
  - Worker A: create lock for track 001
  - Worker B: attempt to lock track 001 → blocked
  - Worker A: unlock track 001
  - Worker B: now can lock track 001
- [x] **E2E Test**: Stale lock recovery
  - Create lock with old timestamp
  - Run `/laneconductor implement` → triggers stale detection
  - User confirms cleanup → lock removed
- [x] **E2E Test**: UI lock visibility
  - Create lock file
  - Refresh Kanban UI → lock icon appears
  - Unlock via UI button → icon disappears
- [x] **E2E Test**: Merge conflict handling
  - Create two branches that conflict
  - Lock and modify track
  - Unlock → merge conflict → prompt user
- [x] Run full test suite: `npm test` (all layers)
- [x] Manual testing: create real scenario with multiple tracks, locks, unlocks

**Exit Criteria**:
- All E2E tests pass
- No regressions in existing worker coordination
- CLI, API, and UI all work together
- Merge conflicts are handled gracefully

---

## Summary of Changes

| Layer | File | Change |
|-------|------|--------|
| CLI | `conductor/lock-status.mjs` | NEW: Lock status listing |
| CLI | `conductor/commands/unlock.mjs` | NEW: Unlock/force-unlock logic |
| CLI | `cli/lc.mjs` | Add `locks`, `unlock` commands |
| DB | Schema | NEW: `track_locks` table; ALTER `tracks` add lock columns |
| Worker | `conductor/laneconductor.sync.mjs` | Watch `.conductor/locks/`, sync to DB |
| UI | `ui/src/components/TrackCard.tsx` | Add lock icon + tooltip |
| UI | `ui/src/api/tracks.ts` | Add GET/POST lock endpoints |
| API | `ui/api/routes/tracks.ts` | Add lock visibility + unlock endpoints |
| Skill | SKILL.md | Update `/laneconductor unlock` command docs |
| Tests | `conductor/tests/` | Add E2E tests for lock lifecycle |

---

## ✅ COMPLETE
Track complete when all phases pass testing and are integrated into main.
