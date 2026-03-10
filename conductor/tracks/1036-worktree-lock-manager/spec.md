# Spec: Worktree Lock Manager

## Problem Statement
When LaneConductor spawns a worker to implement a track, it locks the track's git worktree to prevent other workers from simultaneously modifying the same branch. However, there is currently **no visibility** into which tracks are locked, who owns the lock, or how long the lock has been held. Additionally, there is **no way to release a lock** except by letting the process complete naturally or killing the process.

This creates operational blindness:
- Can't see which tracks are "stuck" in a locked state
- Can't recover from crashes or stale locks without manual git cleanup
- Can't release a lock and merge partial progress back to main while keeping the track in its current lane
- Can't force-unlock a dead worker's lock

## Requirements

### REQ-1: Lock Status Visibility in Kanban UI
- **UI Track Card**: Show a lock icon + tooltip when a track is locked
- **Tooltip Content**:
  - Track number
  - Worker who owns the lock (from `.conductor/locks/{track}.lock` JSON)
  - When the lock was acquired (timestamp)
  - How long it's been held (e.g., "locked for 3h 24m")
  - Worktree path (`.git/worktrees/{track}/`)
  - Machine hostname where the lock was taken

### REQ-2: Lock Status Visibility in CLI
- **Command**: `lc locks` (or `lc status --locks`)
- **Output**: Table or tree view showing:
  - Track number and title
  - Lock owner (worker ID / user / machine)
  - Lock acquisition time (ISO timestamp)
  - Age of lock (human readable: "5m", "2h 30m")
  - Worktree status (exists / missing)
  - Stale indicator (red warning if >5 minutes old)

### REQ-3: Unlock with Merge
- **Endpoint**: `POST /api/projects/:id/tracks/:track/unlock` (DB → FS via file_sync_queue)
- **CLI Command**: `lc unlock NNN` or `/laneconductor unlock NNN`
- **Behavior**:
  - Merge the worktree branch back to main (or parent branch)
  - Remove the git lock (`.conductor/locks/{track}.lock`)
  - Remove the git worktree (`.git/worktrees/{track}/`)
  - Keep the track in its current lane (planning / in-progress / review)
  - Update the track's `**Lane Status**` to `success` (or `queue` if merging failed)
  - Log the unlock action to `conversation.md` or a lock history

### REQ-4: Force Unlock (No Merge)
- **Endpoint**: `POST /api/projects/:id/tracks/:track/unlock?force=true` (DB → FS)
- **CLI Command**: `lc unlock NNN --force` or `lc unlock NNN --no-merge`
- **Behavior**:
  - Do NOT merge the worktree branch to main (discards partial work)
  - Remove the git lock (`.conductor/locks/{track}.lock`)
  - Remove the git worktree (`.git/worktrees/{track}/`)
  - Keep the track in its current lane
  - Update the track's `**Lane Status**` to `queue` (ready to retry)
  - Log the force-unlock action and reason to `conversation.md`
  - **Safety**: UI should show a confirmation dialog ("This will discard partial work. Continue?")

### REQ-5: Lock Stale Detection & Auto-Cleanup
- **Stale Threshold**: 5 minutes (as per existing Worker Coordination doc)
- **Auto-Cleanup**:
  - When `/laneconductor implement` or `/laneconductor lock` is called, detect stale locks
  - Automatically remove locks older than 5 minutes and emit a warning
  - Log the auto-cleanup action to `conversation.md`
  - Allow user to restore the lock if they know the process is still running

### REQ-6: Lock Metadata Persistence
- **Storage**: `.conductor/locks/{track}.lock` (JSON, committed to git)
- **Fields**:
  ```json
  {
    "track_number": "NNN",
    "owner": {
      "user": "claude-code",
      "machine": "hostname",
      "cli": "claude",
      "pattern": "implement|plan|review|quality-gate"
    },
    "started_at": "2026-03-06T14:32:00Z",
    "worktree_path": ".git/worktrees/1036/",
    "branch": "track-1036-worktree-lock-manager",
    "status": "active" | "stale" | "orphaned"
  }
  ```
- **Sync to DB**: Worker syncs lock files to `track_locks` table for UI visibility

### REQ-7: Database Schema Updates
- **Table**: `track_locks` (if not already present)
  ```sql
  CREATE TABLE track_locks (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    track_number TEXT NOT NULL,
    owner_user TEXT,
    owner_machine TEXT,
    owner_cli TEXT,
    owner_pattern TEXT,
    started_at TIMESTAMP,
    worktree_path TEXT,
    branch_name TEXT,
    status TEXT DEFAULT 'active',  -- active|stale|orphaned
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, track_number)
  );
  ```

## Acceptance Criteria
- [ ] `lc locks` command displays all locked tracks with age and owner metadata
- [ ] Kanban UI shows lock icon on locked track cards with tooltip
- [ ] `lc unlock NNN` merges worktree and removes lock without changing track lane
- [ ] `lc unlock NNN --force` discards work and removes lock without changing track lane
- [ ] Stale locks (>5m) are auto-detected and can be auto-cleaned with confirmation
- [ ] Lock metadata is persisted in `.conductor/locks/{track}.lock` (JSON)
- [ ] Worker syncs lock files to Postgres `track_locks` table
- [ ] All unlock actions are logged to track's `conversation.md`
- [ ] API endpoints are secured (optional auth token if multi-user)

## Data Model Changes

### New Git File
```
.conductor/locks/{track}.lock  (JSON, committed to git)
```

### Modified Postgres Schema
```sql
-- New table for lock visibility
CREATE TABLE track_locks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER,
  track_number TEXT,
  owner_user TEXT,
  owner_machine TEXT,
  started_at TIMESTAMP,
  status TEXT,
  UNIQUE(project_id, track_number)
);

-- Modified tracks table (add lock status column if not already present)
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS worktree_locked BOOLEAN DEFAULT false;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS lock_owner TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS lock_acquired_at TIMESTAMP;
```

## Implementation Notes
1. Lock files are committed to git to ensure cross-machine visibility (offline-first)
2. Stale lock auto-cleanup uses 5-minute threshold per existing Worker Coordination logic
3. UI polling (every 2s) will detect lock status changes automatically
4. Force-unlock is a dangerous operation — require explicit flag and UI confirmation
5. All unlock actions are audit-logged to track's conversation for accountability
