# Spec: Heartbeat & Sync Hardening

## Problem Statement

The heartbeat worker fires redundant DB writes on every file change event (even duplicate
editor saves) and has no timeout mechanism for stuck CLI processes. The dashboard polls
every 2 seconds instead of receiving push updates. Config changes require a full worker
restart. Spawned CLIs produce no logs. Inspired by openclaw's Gateway debounce/hash pattern
and VRipper's event-driven, state-machine-driven background worker architecture.

## Requirements

### REQ-1: Watcher debounce
- `syncTrack()` and `syncConductorFiles()` must be debounced at ≥250ms per file path
- Rapid save events (VS Code writes 2-3x per save) must not cause multiple DB round-trips

### REQ-2: Hash-based cache for conductor files
- `syncConductorFiles()` must compute a hash of all conductor .md content before UPDATEing Postgres
- If the hash matches the last pushed hash, skip the UPDATE
- Hash stored in memory (no new DB column required)

### REQ-3: WebSocket push from Express API
- Express API (`:8091`) must expose a WebSocket endpoint (`ws://localhost:8091/ws`)
- After every `syncTrack()` DB write, a `{type:'track:updated', trackNumber, laneStatus, progress}` event is broadcast
- React dashboard adds a `useWebSocket` hook that re-fetches on event receipt
- Polling (`usePolling`) is kept as fallback if WebSocket is unavailable
- Dependency: `ws` npm package added to UI server deps

### REQ-4: Subprocess timeout watchdog
- `spawnCli()` must kill the spawned process after a configurable timeout (default: `LC_SPAWN_TIMEOUT_MS` env var, fallback 300000ms / 5 min)
- On kill: log `[timeout] Track NNN — killed after Xs` and reset `auto_implement_launched = NULL` in DB so the track can be retried

### REQ-5: PID guard in Makefile `lc-start`
- `make lc-start` must check `kill -0 $(cat conductor/.sync.pid) 2>/dev/null` before starting
- If alive: print `⚠️ Worker already running (PID: NNN). Use make lc-stop first.` and exit 1

### REQ-6: CLI stdout capture to log file
- Spawned `claude`/`gemini` processes must pipe stdout+stderr to `conductor/logs/run-NNN-<timestamp>.log`
- `conductor/logs/` directory must be created if absent
- `stdio` changed from `'ignore'` to `['ignore', logFileDescriptor, logFileDescriptor]`

### REQ-7: Config hot-reload
- Worker must watch `.laneconductor.json` with a 500ms debounce
- On change: re-read the file, reconnect the Postgres pool with the new config, log `[config] Reloaded .laneconductor.json`
- Must not restart the chokidar watchers (only the DB pool)

### REQ-8: Sync state machine (optional, Phase 4)
- Add `sync_status TEXT DEFAULT 'synced'` column to `tracks` table
- Worker sets `sync_status = 'syncing'` before Postgres write, `'synced'` after
- On startup: query `WHERE sync_status = 'syncing'` and replay those track files

## Acceptance Criteria

- [ ] Saving a plan.md rapidly 5 times in 1 second triggers exactly 1 DB write (REQ-1)
- [ ] Syncing identical conductor files twice sends exactly 1 UPDATE (REQ-2)
- [ ] Dragging a Kanban card on the dashboard reflects within 200ms in the UI (REQ-3)
- [ ] A stuck `claude` spawn is killed after the timeout; track becomes retryable (REQ-4)
- [ ] Running `make lc-start` twice shows a warning on the second invocation (REQ-5)
- [ ] After an auto-implement run, `conductor/logs/run-NNN-*.log` contains CLI output (REQ-6)
- [ ] Changing `.laneconductor.json` DB host while worker is running is picked up without restart (REQ-7)

## Out of Scope

- gRPC IPC layer between worker and API (VRipper pattern — too heavy for current stage)
- Redis pub-sub (unnecessary; Node.js EventEmitter sufficient for single-machine use)
- Active hours filtering (openclaw heartbeat pattern — post-011 concern)
- AGENTS.md root file (separate track)
