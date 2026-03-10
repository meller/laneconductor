# Spec: Worker Coordination Architecture

## Overview

LaneConductor enables two distinct work patterns that must coordinate seamlessly:
1. **Direct CLI invocation** (offline-capable, any machine, no persistent daemon)
2. **Persistent daemon** (multi-machine, coordinated claiming, DB-aware)

This spec defines the three-layer coordination system that enables both patterns to work together safely.

## Coordination Layers

### Layer 1: Git Lock (Source of Truth)

**Purpose**: Offline-first coordination via git commits.

**Mechanism**:
- Each claimed track creates `.conductor/locks/{track_number}.lock`
- Lock file is **committed to git**
- Both CLI and daemon must check for locks before claiming
- Lock prevents simultaneous work on same track

**Lock File Format**:
```json
{
  "user": "user",
  "machine": "machine",
  "started_at": "2026-02-27T18:00:00.000Z",
  "cli": "claude",
  "track_number": 1010,
  "lane": "in-progress",
  "pattern": "cli|daemon"
}
```

**Lock Lifecycle**:
1. Check if lock exists (git)
2. If exists and <5min old → error "locked by other user"
3. If exists and >5min old → stale, remove it
4. Create lock with current user/machine info
5. **Commit lock to git**
6. Work on track
7. Remove lock file
8. **Commit removal to git**

**Availability**: Works offline (git always available locally)

**Visibility**: Any user can `git fetch && git log` to see what others are working on

---

### Layer 2: Git Worktree (Isolation)

**Purpose**: Prevent git conflicts during parallel execution.

**Mechanism**:
- Each in-progress track gets isolated `git worktree`
- Worktree path: `.git/worktrees/{track_number}/`
- Worker creates/manages worktree lifecycle
- All changes committed to track's branch (not main)

**Worktree Lifecycle**:
1. Track moves to `in-progress` (via UI or CLI)
2. Worker creates: `git worktree add .git/worktrees/{track_number}/ origin/main`
3. All processes work **within that worktree** (isolated working tree)
4. Commits go to track's branch
5. On completion: `git worktree remove .git/worktrees/{track_number}/`

**Benefits**:
- No git conflicts during parallel runs
- Each track has isolated staging area
- Can commit independently per track
- Easy to re-run if needed (just recreate worktree)

---

### Layer 3: Database (Optional Sync & UI Coordination)

**Purpose**: Optional synchronization for UI visibility when DB is available.

**Mechanism**:
- DB `lane_action_status` reflects git lock state
- When DB available: sync lock state FROM git TO DB
- When DB unavailable: git lock is sufficient
- DB is **not** source of truth (file/git is)
- **Remote Sync**: If remote collector API configured in `.laneconductor.json`, sync locks to remote DB via API:
  ```
  POST /track/{track}/lock {
    locked_by: "user@machine",
    locked_at: "2026-02-27T18:00:00Z",
    pattern: "cli|daemon"
  }
  ```
  This allows remote workers to see local locks

**Sync Points**:
1. Before claiming: sync git locks to DB
2. After lock creation: update DB `lane_action_status = 'running'`
3. After lock removal: update DB based on file state (`lane_action_status = 'success'` or `queue`)

**Database Schema Updates**:
```sql
ALTER TABLE tracks ADD COLUMN (
  worktree_path TEXT,           -- e.g., .git/worktrees/1010/
  git_branch TEXT,              -- e.g., feature/1010
  locked_by TEXT,               -- e.g., "user@machine"
  lock_created_at TIMESTAMP     -- when lock was created
);

CREATE TABLE track_locks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  track_number TEXT NOT NULL,
  user TEXT NOT NULL,
  machine TEXT NOT NULL,
  locked_at TIMESTAMP DEFAULT NOW(),
  lock_file_path TEXT,
  pattern TEXT DEFAULT 'cli',   -- 'cli' or 'daemon'
  UNIQUE(project_id, track_number)
);
```

---

## Work Pattern 1: CLI-driven Execution

**When**: User runs `/laneconductor implement {track}`

**Requirements**:
- Works **offline** (no DB required)
- Can be invoked from any machine
- Must check git locks before claiming

**Flow**:
```
1. User: /laneconductor implement 1010

2. Skill checks lock:
   git fetch origin main
   if (.conductor/locks/1010.lock exists):
     if (lock age < 5min):
       ERROR "track locked by {user}@{machine}"
     else:
       rm .conductor/locks/1010.lock

3. Skill creates lock:
   Create .conductor/locks/1010.lock
   git add .conductor/locks/1010.lock
   git commit -m "Lock track 1010"

4. Skill creates/enters worktree:
   git worktree add .git/worktrees/1010/ origin/main

5. Skill performs work:
   (implement phases, commit changes)
   All commits go to track's branch

6. Skill exits:
   Update file: Lane Status = success
   git commit changes
   rm .conductor/locks/1010.lock
   git commit -m "Unlock track 1010"
   git worktree remove .git/worktrees/1010/

7. If DB available:
   PATCH /track/1010/action { lane_action_status: 'success' }
```

**Exit Guarantees**:
- Lock ALWAYS removed (even on error)
- Worktree ALWAYS cleaned up
- All changes committed to git

---

## Work Pattern 2: Daemon-driven Execution

**When**: Persistent worker daemon claims queued tracks

**Requirements**:
- Runs continuously on specific machine
- Polls for queued tracks
- Coordinates with DB (optional)
- Must check git locks before claiming

**Flow**:
```
Every 5 seconds:

1. Daemon: git fetch origin main

2. Daemon: Check git locks
   ls .conductor/locks/ to see current locks
   Update DB: sync lock state to lane_action_status

3. Daemon: Query API for claimable tracks
   POST /tracks/claim-queue { limit: 1 }
   (API returns tracks with lane_action_status = 'queue')

4. Daemon: Verify no git lock exists for returned track
   if (.conductor/locks/{track}.lock):
     SKIP (other worker already claimed)

5. Daemon: Atomic DB claim (if DB available)
   UPDATE tracks SET lane_action_status = 'running'
   WHERE track_number = X AND lane_action_status = 'queue'
   (only succeeds if no one else claimed it)

6. Daemon: Create lock
   Create .conductor/locks/{track}.lock
   git add .conductor/locks/{track}.lock
   git commit -m "Lock track {track}"
   git push (if remote available)

7. Daemon: Create worktree
   git worktree add .git/worktrees/{track}/ origin/main

8. Daemon: Spawn process
   spawnCli(..., { cwd: .git/worktrees/{track}/ })

9. Process exits:
   Exit handler:
     - Update file: Lane Status
     - Commit to git
     - Remove lock + commit removal
     - Remove worktree
     - PATCH DB to update status

10. Repeat (next 5-second cycle)
```

**Parallel Limit Enforcement**:
- Query DB: `SELECT COUNT(*) FROM tracks WHERE lane_status='{lane}' AND lane_action_status='running'`
- Only claim if count < `parallel_limit`
- Or use git locks: check `.conductor/locks/` for that lane

---

## Conflict Resolution

**Scenario 1: Two workers try to claim same track**

```
Time 1: Worker A runs: git fetch, no lock exists
Time 1: Worker B runs: git fetch, no lock exists
Time 2: Worker A creates lock, commits to git
Time 2: Worker B creates lock, tries to commit
        → Git merge conflict or Worker B sees lock
        → Worker B skips this track
```

**Resolution**: Whoever commits lock first wins. Other worker checks lock before claiming.

**Scenario 2: Lock file stale (process crashed)**

```
Lock file exists but older than 5 minutes
→ Assume worker crashed
→ Remove lock
→ Claim track and continue
```

**Scenario 3: Process completes but DB not reachable**

```
Exit handler:
- Update file (always works)
- Commit to git (always works)
- Remove lock (always works)
→ DB will be updated when worker comes online
   (file sync catches up eventually)
```

---

## Key Design Decisions

1. **Git lock is source of truth** (not DB)
   - Rationale: Works offline, always available
   - DB is optional enhancement for UI coordination

2. **Worktree per track** (not shared main)
   - Rationale: Prevents git conflicts, isolates changes
   - Each track owns its working directory

3. **Lock committed to git** (not just in-memory)
   - Rationale: Visible to all workers (offline-capable)
   - Survives worker restart

4. **5-minute stale timeout**
   - Rationale: Balance safety vs. recovery
   - Allows recovery from crashes without admin action

5. **File sync drives DB updates** (not vice versa)
   - Rationale: Git/file is source of truth
   - DB syncs FROM files, not the other way

---

## Error Handling

**Lock check fails**:
```
if (lock exists and < 5min old):
  ERROR "Track locked by {user}@{machine} since {time}"
  Suggest: wait, or ask user to unlock manually
```

**Worktree creation fails**:
```
Skip this track
Wait until next cycle
Try again
If persistent: manual investigation needed
```

**Commit fails**:
```
Log error but continue
Next cycle: git push will retry
If persistent: check git status manually
```

**Process exit handler fails**:
```
Log each sub-task:
  - [✓] Updated file
  - [✓] Committed changes
  - [✗] Remove lock failed → manual cleanup needed
  - [✓] Removed worktree
  - [✓] Updated DB
```

---

## Files to Create

`.conductor/locks/` — Directory for lock files
```
.gitignore:
.conductor/locks/*.lock  (but we COMMIT the .lock files, so not ignored)
```

Actually, `.conductor/locks/` SHOULD be tracked in git so other workers see the locks!

```
.conductor/
├── locks/
│   ├── 1010.lock  ← COMMITTED to git
│   ├── 1011.lock  ← COMMITTED to git
├── tracks-metadata.json
```

---

## Success Criteria

- ✅ Offline coordination works (git locks without DB)
- ✅ Worktrees prevent git conflicts
- ✅ No double-work (atomic claiming)
- ✅ CLI pattern works standalone
- ✅ Daemon pattern coordinates multiple workers
- ✅ DB optional (syncs when available)
- ✅ Stale locks cleaned up automatically
- ✅ All changes committed to git (audit trail)
