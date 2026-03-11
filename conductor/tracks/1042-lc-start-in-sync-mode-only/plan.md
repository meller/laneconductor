# Track 1042: lc start in sync mode only

## Phase 1: Schema & CLI Setup

**Goal**: Add `worker.mode` config field and CLI flag support

- [x] Update `bin/lc.mjs` `start` command to accept `--sync-only` flag
- [x] Parse CLI flag and pass mode to sync worker invocation
- [x] Document the flag in help text and README
- [x] Add `worker.mode` field to `.laneconductor.json` schema (optional, defaults to `"sync+poll"`)
- [ ] Update `setup collection` workflow to ask about worker mode preference
- [x] Write test: config with/without `worker.mode` defaults correctly

**Acceptance**: `lc start --sync-only` passes mode to worker; config schema includes new field

---

## Phase 2: Sync Worker Mode Implementation

**Goal**: Implement mode-aware logic in `laneconductor.sync.mjs`

- [x] Read mode from `.laneconductor.json` or CLI args at startup
- [x] Conditional queue-polling logic:
  - If `sync-only`: skip the queue polling loop entirely
  - If `sync+poll`: keep existing poll logic (claim tracks, spawn processes)
- [x] Conditional track spawning:
  - If `sync-only`: never call `spawnCli()` for queue tracks
  - If `sync+poll`: existing behavior
- [x] Store mode in-process so it's available to child processes/exit handlers
- [x] Log worker mode at startup: `"Worker mode: sync-only"` or `"Worker mode: sync+poll"`
- [x] Test: both modes can read/write files via chokidar (sync still works)
- [x] Test: sync-only mode never attempts to claim tracks from queue

**Acceptance**: Worker starts with correct mode; queue polling is conditional on mode

---

## Phase 3: UI Display of Worker Mode

**Goal**: Show worker mode in the Workers list and worker details

- [x] Query worker mode from running process metadata (via heartbeat response to API)
- [x] Update Workers list table to include a "Mode" column
  - Display: "SYNC-ONLY" for sync-only, "SYNC+POLL" for sync+poll
- [x] Add mode to worker details card (click to expand)
- [x] Update worker status badge to indicate mode visually (color-coded badge)
- [x] Test: UI correctly displays mode for both sync-only and sync+poll workers

**Acceptance**: UI shows worker mode in Workers list; mode is clearly visible

---

## Phase 4: Integration & Testing

**Goal**: Full end-to-end testing and integration across CLI, worker, and UI

- [x] Test: `lc start` without flag respects `.laneconductor.json` mode
- [x] Test: `lc start --sync-only` overrides config
- [x] Test: Track state transitions work in both modes (manual via `/laneconductor` commands)
- [x] Test: Sync-only worker syncs filesystem→DB on file changes
- [x] Test: Sync+poll worker auto-claims and runs tracks (existing behavior preserved)
- [x] Test: Workflow transitions work correctly (lane transitions, retries, etc.)
- [x] Integration: Create a track in sync-only mode, manually run via CLI, verify sync to DB
- [x] Integration: Create a track in sync+poll mode, verify auto-run and DB sync
- [x] Documentation: Add examples to SKILL.md and README

**Acceptance**: Both modes fully functional; all tests pass; documentation updated

---

## Phase 5: Backwards Compatibility & Cleanup

**Goal**: Ensure existing projects and workflows continue to work

- [x] Migrate any existing `.laneconductor.json` files (none needed — backward compatible)
- [x] Test: Old config without `worker.mode` defaults to `"sync+poll"`
- [x] Test: Existing Makefile targets (`make lc-start`, etc.) use default mode
- [x] Verify: No breaking changes to API endpoints or database schema
- [x] Update MEMORY.md with worker mode details for future sessions

**Acceptance**: Existing projects work unchanged; no breaking changes

---

## ✅ Success Criteria

- Worker mode configuration is available and working
- CLI flag `--sync-only` overrides config
- UI displays worker mode clearly
- Both modes fully tested and documented
- Backward compatible with existing projects
