# Track 011: Heartbeat & Sync Hardening ✅ QUALITY PASSED

## Research Summary

Studied **openclaw/openclaw** (Node.js AI gateway, 220k+ stars) and **dev-claw/vripper-project**
(Java/Spring download manager with production-grade background worker) to identify patterns
applicable to LaneConductor's heartbeat worker and dashboard.

### Key findings from openclaw
- Gateway debounces config file changes at 300ms (`gateway.reload.debounceMs`)
- Skills snapshot system hashes workspace file mtimes → skips re-processing if unchanged
- Lobster subprocess shell kills spawns after configurable timeout + stdout size limit
- Dashboard (actionagentai/openclaw-dashboard) uses WebSocket with exponential-backoff reconnect

### Key findings from VRipper
- Spring WebSocket + STOMP pushes download progress to Angular frontend in real time (no polling)
- Clipboard watcher debounces + deduplicates before triggering scan
- State machine per item: `PENDING → SCANNING → DOWNLOADING → DONE | ERROR | STOPPED`
- gRPC IPC between headless server and desktop client (split-process architecture)
- On restart: queries for items in `DOWNLOADING` state → replays them (resumable queue)

---

## Phase 1: Watcher Hardening (debounce + hash cache) ✅ COMPLETE

**Problem**: chokidar fires on every write; VS Code saves 2-3x per save; conductor files always UPDATE Postgres even when unchanged.
**Solution**: Add per-path debounce map (250ms); add in-memory hash of last-pushed conductor files content.

- [x] Task 1.1: Add debounce wrapper in `laneconductor.sync.mjs`
    - [x] Create `const debounceMap = new Map()` at module scope
    - [x] Wrap `syncTrack(f)` calls in a 250ms debounce keyed on `f`
    - [x] Wrap `syncConductorFiles()` calls in a 250ms debounce (single key `'conductor'`)
- [x] Task 1.2: Add hash-based cache for `syncConductorFiles()`
    - [x] Import `createHash` from Node `crypto`
    - [x] Compute `sha256` of the serialized `files` JSON before UPDATEing
    - [x] Store `lastConductorHash` in module scope; skip UPDATE if hash matches
    - [x] Log `[sync] conductor files — unchanged, skipping` when skipped

**Impact**: Eliminates redundant DB writes; reduces Postgres load during active editing sessions.

---

## Phase 2: WebSocket Push — Replace UI Polling with Live Events ✅ COMPLETE

**Problem**: Dashboard polls every 2s; cards update with ~2s lag during active implement sessions.
**Solution**: Add `ws` WebSocket server to Express API; broadcast after every `syncTrack()` write; React subscribes with polling fallback.

- [x] Task 2.1: Add WebSocket server to Express API (`ui/server/index.mjs`)
    - [x] `npm install --save ws` in `ui/`
    - [x] Attach a `WebSocket.Server` to the existing Express HTTP server (shared port 8091)
    - [x] Export an `emit(event)` function from a shared `wsBroadcast.mjs` module
    - [x] Handle client connect/disconnect; log client count
- [x] Task 2.2: Broadcast from sync worker after DB write
    - [x] After successful `pool.query()` in `syncTrack()`, call `emit('track:updated', {trackNumber, laneStatus, progress})`
    - [x] Worker and API run in different processes → use a lightweight IPC channel (Node.js EventEmitter won't cross processes)
    - [x] Use a simple approach: worker POSTs to `http://localhost:8091/internal/sync-event` after each write; API broadcasts to WS clients
    - [x] Add `POST /internal/sync-event` route in Express (localhost-only, no auth needed)
- [x] Task 2.3: Add `useWebSocket` hook to React dashboard
    - [x] Create `ui/src/hooks/useWebSocket.js`
    - [x] Connect to `ws://localhost:8091/ws` on mount
    - [x] On `track:updated` message: trigger a targeted refetch of that track's data
    - [x] On WS unavailable/closed: fall back to existing `usePolling` behavior
    - [x] Implement exponential-backoff reconnect (pattern from openclaw-dashboard)

**Impact**: Cards update within ~100ms of file save; polling kept as fallback for resilience.

---

## Phase 3: Process Management Hardening ✅ COMPLETE

**Problem**: Hung `claude` spawns block auto-implement loop forever; no stdout capture; `make lc-start` can launch duplicates.
**Solution**: Timeout watchdog per spawn; log file per run; PID guard in Makefile.

- [x] Task 3.1: Subprocess timeout watchdog in `spawnCli()`
    - [x] Read `LC_SPAWN_TIMEOUT_MS` env var (fallback: 300000 = 5 min)
    - [x] `const killer = setTimeout(() => { proc.kill('SIGTERM'); ... }, timeout)` after spawn
    - [x] On `proc.exit`: `clearTimeout(killer)`
    - [x] On timeout kill: log `[timeout] PID killed after ${timeout}ms`, reset `auto_implement_launched = NULL` in DB
- [x] Task 3.2: CLI stdout capture to log file
    - [x] Create `conductor/logs/` directory if absent (on worker startup)
    - [x] Per spawn: open `conductor/logs/run-${trackNumber}-${Date.now()}.log` with `fs.openSync(..., 'a')`
    - [x] Pass file descriptor as `stdio[1]` and `stdio[2]` in spawn options (instead of `'ignore'`)
    - [x] Log `[spawn] stdout → conductor/logs/run-${trackNumber}-*.log`
- [x] Task 3.3: PID guard in Makefile `lc-start`
    - [x] Add check before `node conductor/laneconductor.sync.mjs &`:
      ```make
      @if [ -f conductor/.sync.pid ] && kill -0 $$(cat conductor/.sync.pid) 2>/dev/null; then \
        echo "⚠️  Worker already running (PID: $$(cat conductor/.sync.pid)). Use make lc-stop first."; \
        exit 1; \
      fi
      ```

**Impact**: No more indefinitely-blocked auto-implement loops; full audit trail of CLI output; no duplicate workers.

---

## Phase 4: Config Hot-Reload + Sync State Machine ✅ COMPLETE

**Problem**: `.laneconductor.json` changes require worker restart; no way to audit which tracks failed to sync.
**Solution**: Watch config with debounce + reconnect pool; add `sync_status` column for retry-on-startup.

- [x] Task 4.1: Config hot-reload
    - [x] Add a chokidar watch on `.laneconductor.json` with 500ms debounce
    - [x] On change: `pool.end()`, re-read config, create new `pg.Pool` with updated creds
    - [x] Log `[config] Reloaded .laneconductor.json — reconnected Postgres pool`
- [x] Task 4.2: Add `sync_status` column to tracks
    - [x] Migration: `ALTER TABLE tracks ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'synced'`
    - [x] In `syncTrack()`: set `sync_status = 'syncing'` at start of query, `'synced'` at end (use separate UPDATE after success)
    - [x] On worker startup: query `WHERE sync_status = 'syncing'` → log and replay those track files
    - [x] Update DB schema doc in SKILL.md

**Impact**: No restart required for config changes; tracks that crashed mid-sync are automatically replayed on next start.

## ✅ REVIEWED
Track 011 has been fully reviewed and all requirements and acceptance criteria have been verified.
- Watcher debounce and hash cache reduce DB load.
- WebSocket push provides real-time UI updates.
- Process management hardening prevents hung spawns and provides logging.
- Config hot-reload and sync state machine improve resilience.

## ✅ QUALITY PASSED
All automated checks defined in conductor/quality-gate.md have passed successfully.
- Syntax, Critical Files, Config, Database, Tests, Coverage, and Security checks are GREEN.
