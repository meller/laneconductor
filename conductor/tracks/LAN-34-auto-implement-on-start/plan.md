# Track 010: Auto-Implement on Start

## Phase 1: Transition detection in heartbeat worker ✅ COMPLETE

**Problem**: Worker has no awareness of fresh in-progress transitions.
**Solution**: Add a poll loop to `laneconductor.sync.mjs` that queries for eligible tracks.

- [x] Task 1: Add `auto_implement_launched` column to DB schema
    - [x] `ALTER TABLE tracks ADD COLUMN IF NOT EXISTS auto_implement_launched TIMESTAMP`
    - [x] Run migration via psql
- [x] Task 2: Add detection poll to sync worker
    - [x] Query every 5s: `lane_status='in-progress' AND progress_percent=0 AND auto_implement_launched IS NULL`
    - [x] Filter to current `project_id` only
    - [x] Log detected tracks

## Phase 2: Auto-launch with duplicate prevention ✅ COMPLETE

**Problem**: Need to fire Claude CLI once per fresh in-progress transition, never twice.
**Solution**: Set `auto_implement_launched = NOW()` before spawning, check for existing process.

- [x] Task 1: Mark track as launched before spawning
    - [x] `UPDATE tracks SET auto_implement_launched = NOW() WHERE ...` (prevents race condition on next poll)
- [x] Task 2: Spawn CLI process
    - [x] Read `primary_cli` from project row (`project.primary?.cli`)
    - [x] Build command: `claude --dangerously-skip-permissions -p "/laneconductor implement NNN"`
    - [x] Use `child_process.spawn` (detached, not blocking the worker)
    - [x] Track running PIDs in `runningPids` Set — skip if one already running
    - [x] Log: `[auto-implement] Track NNN → implement (PID: XXXX)`
- [x] Task 3: Expose `auto_implement_launched` in API responses
    - [x] Add to `GET /api/projects/:id/tracks` and track detail query

## Phase 3: UI indicator + manual re-run ✅ COMPLETE

**Problem**: No visibility into auto-launch state, no way to re-run from UI.
**Solution**: Badge on card + re-run button + API endpoint.

- [x] Task 1: Add "Auto-started" badge to TrackCard
    - [x] Show when `auto_implement_launched` is set and `progress_percent === 0`
    - [x] Style: small gray pill `⚡ auto-started`
- [x] Task 2: Add "Re-run implement" button to TrackCard
    - [x] Show for in-progress cards where `progress_percent > 0`
    - [x] Calls `POST /api/projects/:id/tracks/:num/implement`
- [x] Task 3: Add `POST /api/projects/:id/tracks/:num/implement` endpoint
    - [x] Sets `auto_implement_launched = NOW()` (prevent double-fire from worker)
    - [x] Spawns CLI process same as Phase 2
    - [x] Returns `{ ok: true, pid }`

## Phase 4: Auto-review on transition to review lane ✅ COMPLETE

**Problem**: Moving a track to review requires manually running `/laneconductor review NNN`.
**Solution**: Same poll pattern — detect fresh `review` transitions and fire the review CLI.

- [x] Task 1: Add `auto_review_launched` column to DB schema
    - [x] `ALTER TABLE tracks ADD COLUMN IF NOT EXISTS auto_review_launched TIMESTAMP`
    - [x] Run migration
- [x] Task 2: Add review transition detection to poll loop
    - [x] Query: `lane_status='review' AND auto_review_launched IS NULL`
    - [x] Reset `auto_review_launched = NULL` each time track re-enters review (review re-fires every gate)
- [x] Task 3: Spawn review CLI
    - [x] Command: `claude --dangerously-skip-permissions -p "/laneconductor review NNN"`
    - [x] Set `auto_review_launched = NOW()` before spawning
    - [x] Log: `[auto-review] Launched review for track NNN`

## Phase 5: Done-vs-Review lane distinction ✅ COMPLETE

**Problem**: `✅ COMPLETE` + no open tasks moved directly to `done`, bypassing review. All finished tracks need human or auto-review before `done`.
**Solution**: `parseStatus` in sync.mjs now uses two-tier markers: `✅ COMPLETE` → `review`, `✅ REVIEWED` → `done`. Review skill appends `## ✅ REVIEWED` on PASS.

- [x] Task 1: Update `parseStatus` in `laneconductor.sync.mjs`
    - [x] Add `✅ REVIEWED` → `done` as highest-priority match
    - [x] Change `✅ COMPLETE` (no open tasks) → `review` instead of `done`
- [x] Task 2: Add `## ✅ REVIEWED` to all previously-confirmed-done tracks (003–008)
- [x] Task 3: Update SKILL.md badge mapping table to reflect new two-tier logic
- [x] Task 4: Update SKILL.md review Step 5 PASS action to document `✅ REVIEWED` append

## ✅ REVIEWED
