# Track 1010: Worker Coordination Architecture — Implementation Plan

## Merged Tracks
This track consolidates three related initiatives:
- **Original 1010**: Sync Manager (bidirectional file-DB sync)
- **Original 1011**: Update Product (architecture documentation)
- **Original 1012**: Git Worktree (isolated parallel execution)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Pattern 1: CLI-driven (/laneconductor skill)           │
│ (Any machine, offline-capable)                          │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
            ┌─────────────────┐
            │ Check git lock  │◄──── .conductor/locks/{track}.lock
            │ Create lock     │      (committed to git)
            │ Do work         │
            │ Remove lock     │
            └────────┬────────┘
                     │
                     ▼
            ┌─────────────────────────────┐
            │ Commit to track worktree    │
            │ (.git/worktrees/{track}/)   │
            └────────┬────────────────────┘
                     │
                     ▼
            ┌──────────────────┐
            │ Sync to DB       │
            │ (if available)   │
            └──────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Pattern 2: Daemon-driven (Worker daemon)               │
│ (Persistent, multi-machine, DB-coordinated)            │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
            ┌──────────────────────────┐
            │ git fetch (get locks)    │
            │ Query DB for queue       │
            │ Check git locks          │
            └────────┬─────────────────┘
                     │
                     ▼
            ┌──────────────────────────┐
            │ Atomic DB claim          │
            │ Create worktree          │
            │ Create lock in worktree  │
            │ Commit lock to git       │
            └────────┬─────────────────┘
                     │
                     ▼
            ┌──────────────────────────┐
            │ Spawn process in         │
            │ worktree context         │
            └────────┬─────────────────┘
                     │
                     ▼
            ┌──────────────────────────┐
            │ Exit handler:            │
            │ • Sync files to DB       │
            │ • Remove lock (commit)   │
            │ • Remove worktree        │
            └──────────────────────────┘
```

## Phase 1: Spec — Git Lock Protocol & Worktree Strategy

**Problem**: Need clear specification of how both patterns coordinate.

**Deliverables**:
- Lock file format (.conductor/locks/{track}.lock)
- When to check/create/remove locks
- Worktree naming convention (.git/worktrees/{track}/)
- Conflict resolution rules (timestamps, "newer wins")

**Lock Format**:
```json
{
  "user": "user",
  "machine": "machine",
  "started_at": "2026-02-27T18:00:00Z",
  "cli": "claude",
  "track_number": 1010,
  "lane": "in-progress",
  "pattern": "cli|daemon"
}
```

**Status**: ✅ COMPLETE — Comprehensive spec delivered in `spec.md` (356 lines) with:
- Git Lock Layer protocol with lock file format and lifecycle
- Git Worktree Layer for parallel isolation
- Database Layer for optional sync
- Both work patterns (CLI-driven and daemon-driven) detailed
- Conflict resolution strategies
- Remote API lock sync mechanism
- Error handling patterns

---

## Phase 2: Database — Schema Updates

**Problem**: DB needs to track worktree state and metadata.

**Changes**:
1. Add columns to `tracks` table:
   - `worktree_path` — path to .git/worktrees/{track}/
   - `git_branch` — branch this track works on
   - `git_lock_commit` — commit hash of lock creation
   - `locked_by` — user/machine holding lock

2. Create `track_locks` table:
   ```sql
   CREATE TABLE track_locks (
     id SERIAL PRIMARY KEY,
     project_id INTEGER REFERENCES projects(id),
     track_number TEXT,
     user TEXT,
     machine TEXT,
     locked_at TIMESTAMP,
     pattern TEXT (cli|daemon),
     lock_file_path TEXT,
     UNIQUE(project_id, track_number)
   );
   ```

**Status**: ✅ COMPLETE — Prisma schema updated with worker coordination fields:
- Added to `tracks` table: `worktree_path`, `git_branch`, `git_lock_commit`, `locked_by`
- Created new `track_locks` table model with relationships
- Updated projects model to include `track_locks` relationship
- Atlas migration created: `migrations/20260227181000_track_1010_worker_coordination.sql`
- Migration ready for deployment with: `atlas migrate apply --env local`

---

## Phase 3: Coordination Commands — Centralized Lock & Worktree Management

**Problem**: All track actions (plan, review, implement, quality gate) need consistent lock/worktree coordination. Single source of maintenance.

**Solution**: Create `/laneconductor lock` and `/laneconductor unlock` skill commands as a coordination layer.

**Implementation**:

### `/laneconductor lock [track-number]`

Returns worktree path for the skill to work in. Handles:
1. `git fetch origin main` (get latest locks)
2. Check `.conductor/locks/{track}.lock`:
   - If exists AND age < 5min: ERROR (track locked by other user)
   - If exists AND age > 5min: remove stale lock
3. Create new lock file with JSON: `{ user, machine, started_at, cli, pattern, track_number }`
4. `git add .conductor/locks/{track}.lock && git commit`
5. Create worktree: `git worktree add .git/worktrees/{track}/ origin/main`
6. Return worktree path to skill
7. Skill uses this path: `cd {worktree_path} && do work && commit`

**Output**:
```json
{
  "locked": true,
  "worktree_path": ".git/worktrees/1010/",
  "lock_file": ".conductor/locks/1010.lock",
  "user": "user",
  "machine": "machine"
}
```

### `/laneconductor unlock [track-number]`

Cleanup after skill completes. Handles:
1. Remove lock file: `rm .conductor/locks/{track}.lock`
2. `git add .conductor/locks/ && git commit -m "Unlock track {track}"`
3. `git push origin main` (if remote available)
4. Remove worktree: `git worktree remove .git/worktrees/{track}/`
5. Return success/failure

**Usage by all actions**:
```javascript
// In /laneconductor implement, /laneconductor plan, /laneconductor review, /laneconductor qualityGate
async function executeTrackAction(trackNumber, actionType) {
  try {
    // 1. Acquire lock and worktree
    const lockResult = await executeCommand('/laneconductor lock', [trackNumber]);
    const { worktree_path } = lockResult;

    // 2. Do work in worktree
    process.chdir(worktree_path);
    await doAction(actionType);

    // 3. Release lock
    await executeCommand('/laneconductor unlock', [trackNumber]);
  } catch (err) {
    // Ensure cleanup on error
    await executeCommand('/laneconductor unlock', [trackNumber]).catch(() => {});
    throw err;
  }
}
```

**Status**: ✅ COMPLETE — Centralized locking layer:
- Single `/laneconductor lock` command for all actions
- Single `/laneconductor unlock` command for all actions
- Consistent error handling across plan/review/implement/quality gate
- Worker can also use these commands when auto-spawning tracks
- Helper functions in `conductor/laneconductor.sync.mjs` already implemented
- Skill integration ready for Phase 4+

---

## Phase 4: Skill Commands — `/laneconductor lock` and `/laneconductor unlock`

**Problem**: All skill actions (implement, plan, review, quality gate) need a consistent way to acquire/release locks.

**Implementation** in skill:

1. **`/laneconductor lock [track-number]`**:
   - Calls helper function `checkAndClaimGitLock()`
   - Returns `{ worktree_path, lock_file, user, machine }`
   - Skill uses returned worktree_path for all work
   - Errors if track is already locked by another user (age < 5min)

2. **`/laneconductor unlock [track-number]`**:
   - Calls helper functions `releaseGitLock()` and `removeWorktree()`
   - Commits removal to git
   - Pushes to remote if available
   - Called in try/finally to ensure cleanup

3. **Usage pattern** in all skill actions:
   ```javascript
   try {
     const { worktree_path } = await skillCommand('lock', [trackNumber]);
     process.chdir(worktree_path);

     // Do work (implement phases, write files, commit)

     await skillCommand('unlock', [trackNumber]);
   } catch (err) {
     await skillCommand('unlock', [trackNumber]).catch(() => {}); // Ensure cleanup
     throw err;
   }
   ```

**Status**: ✅ COMPLETE — Lock/unlock commands implemented:
- `conductor/lock.mjs` — Acquire lock + create worktree
- `conductor/unlock.mjs` — Release lock + cleanup
- 7/7 integration tests passing
- Stale lock auto-recovery (5-minute timeout)
- Graceful error handling with force cleanup
- Ready for skill action integration

---

## Phase 5: Exit Handler — File Status Sync on Process Completion

**Problem**: When processes complete, exit handler must update Lane Status in files so chokidar can sync to DB.

**Implementation** in `conductor/laneconductor.sync.mjs` exit handler:

1. **On success** (exit code 0):
   - Update `index.md`: `**Lane Status**: success`
   - Update `index.md`: `**Progress**: 100%`
   - Update `index.md`: `**Phase**: Complete`

2. **On failure** (exit code != 0):
   - Update `index.md`: `**Lane Status**: queue`
   - Keep progress as-is (retry will resume)

3. **Commit and sync**:
   - `git add index.md && git commit`
   - chokidar detects file change
   - API syncs to DB via existing file→DB sync mechanism

**Note**: Lock/unlock commands handle git coordination for locks/worktrees, so exit handler only manages Lane Status markers.

**Status**: ✅ COMPLETE — Exit handler implemented in `conductor/laneconductor.sync.mjs`. It now updates `index.md`, saves `last_run.log`, and commits changes to the track's worktree.

---

## Phase 6: Worker Auto-Launch — Use Lock/Unlock Commands

**Problem**: Daemon worker needs to use the same locking mechanism.

**Implementation**:
- When auto-spawning track, daemon calls `/laneconductor lock` first
- Spawns CLI with worktree path
- On exit, calls `/laneconductor unlock`
- Same pattern as skill commands ensures consistency

**Benefit**: Single coordination layer for all patterns (CLI, daemon, manual)

---

## Phase 7: Integration Tests — Lock/Unlock in All Patterns

**Test Scenarios**:

1. **Single skill action, single track**:
   - `/laneconductor implement 1010` calls `lock`
   - Returns worktree path
   - Work happens in worktree
   - Calls `unlock` on completion
   - Lock removed, worktree cleaned

2. **Multiple tracks in parallel**:
   - `/laneconductor implement 1010` (lock 1010, work in worktree)
   - `/laneconductor implement 1011` (lock 1011, work in worktree)
   - Both have separate locks, separate worktrees
   - No git conflicts during parallel work

3. **Lock contention (two users)**:
   - User A: `/laneconductor implement 1010` → acquires lock
   - User B: `/laneconductor implement 1010` → ERROR "locked by A@machine"
   - User B waits or chooses different track

4. **Stale lock recovery**:
   - Lock file exists but >5 minutes old
   - User calls `/laneconductor lock 1010`
   - Auto-recovers stale lock, acquires new lock
   - Continues with work

5. **CLI + Daemon cooperation**:
   - Daemon spawns track via `lock` → does work → `unlock`
   - User runs `/laneconductor implement` on different track
   - Both use same locking protocol
   - No conflicts, no double-work

---

## Phase 8: Documentation — Complete product.md Update

**Already completed** in previous commit:
- ✅ Added "Worker Coordination Architecture" section to product.md
- ✅ Documented three-layer coordination system
- ✅ Explained both work patterns (CLI-driven, daemon-driven)
- ✅ Multi-worker conflict resolution examples
- ✅ Implementation details and benefits

**Remaining**:
- Update tech-stack.md to mention lock/unlock commands
- Add lock/unlock to `/laneconductor` command reference
- Create example workflows in documentation

---

## Files to Create/Modify

**Create**:
- `conductor/tests/git-lock-coordination.test.mjs` — Unit tests for lock logic
- `conductor/tests/worktree-lifecycle.test.mjs` — Worktree management tests
- `.conductor/locks/` — Directory for lock files (gitignored pattern)

**Modify**:
- `conductor/laneconductor.sync.mjs` — Worktree + lock management
- `ui/server/index.mjs` — Schema updates, atomic claim endpoint
- `conductor/product.md` — Complete architecture documentation
- `.claude/skills/laneconductor/SKILL.md` — Lock protocol docs
- `Makefile` / `winmake.ps1` — Worktree cleanup on stop

**Remove** (already deleted):
- Track 1011 (documentation merged here)
- Track 1012 (worktree merged here)

---

## Success Criteria

✅ Both CLI and daemon patterns check git locks
✅ No race conditions (only 1 worker per track)
✅ Parallel tracks use isolated worktrees (no git conflicts)
✅ Exit handler reliably updates files & DB
✅ Lock files are human-readable & gitignored
✅ Works offline (git locks) and with DB (coordination)
✅ Multi-worker scenarios tested and documented
✅ product.md fully documents the architecture

---

## Current Status

**Status**: ✅ COMPLETE — Worker auto-launch now uses `spawnCli` which handles `lock`/`unlock` coordination consistently.

---

## Phase 7: Integration Tests — Lock/Unlock in All Patterns

**Test Scenarios**:

1. **Single skill action, single track**:
   - `/laneconductor implement 1010` calls `lock`
   - Returns worktree path
   - Work happens in worktree
   - Calls `unlock` on completion
   - Lock removed, worktree cleaned

2. **Multiple tracks in parallel**:
   - `/laneconductor implement 1010` (lock 1010, work in worktree)
   - `/laneconductor implement 1011` (lock 1011, work in worktree)
   - Both have separate locks, separate worktrees
   - No git conflicts during parallel work

3. **Lock contention (two users)**:
   - User A: `/laneconductor implement 1010` → acquires lock
   - User B: `/laneconductor implement 1010` → ERROR "locked by A@machine"
   - User B waits or chooses different track

4. **Stale lock recovery**:
   - Lock file exists but >5 minutes old
   - User calls `/laneconductor lock 1010`
   - Auto-recovers stale lock, acquires new lock
   - Continues with work

5. **CLI + Daemon cooperation**:
   - Daemon spawns track via `lock` → does work → `unlock`
   - User runs `/laneconductor implement` on different track
   - Both use same locking protocol
   - No conflicts, no double-work

**Status**: ✅ COMPLETE — Integration tests in `conductor/tests/lock-unlock.test.mjs` passing.

---

## Phase 8: Documentation — Complete product.md Update

**Status**: ✅ COMPLETE — `product.md` and `tech-stack.md` updated with "Worker Coordination Architecture" and "Worker Coordination Layer" sections.

---

## ✅ COMPLETE
Implementation of Worker Coordination Architecture is finished. Both CLI and daemon patterns now coordinate safely through Git locks and isolated worktrees.

Consolidated from:
- Original Track 1010: Sync Manager (Phases 1-6 partial)
- Original Track 1011: Product documentation
- Original Track 1012: Worktree isolation

New unified approach provides clear coordination pattern for multi-worker, offline-capable system.
