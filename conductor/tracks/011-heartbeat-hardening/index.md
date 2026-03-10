# Track 011: Heartbeat & Sync Hardening

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem

The current heartbeat worker (`laneconductor.sync.mjs`) has several reliability gaps
identified by studying openclaw (a Node.js AI gateway with 220k+ stars) and VRipper
(a mature Java/Spring download manager with production-grade background worker patterns):

- chokidar fires on every write (editors like VS Code write 2-3x per save) → redundant DB round-trips
- `syncConductorFiles()` always UPDATEs Postgres even if content hasn't changed
- Spawned `claude` processes can hang indefinitely, blocking the auto-implement loop forever
- `.laneconductor.json` requires a worker restart to pick up DB credential changes
- `stdio: 'ignore'` on spawned CLIs makes debugging auto-implement failures impossible
- The Vite dashboard polls every 2s — cards update with a noticeable lag during active implement sessions
- `make lc-start` doesn't check if a worker is already alive before starting a duplicate

## Solution

Apply eight targeted hardening patterns drawn from openclaw + VRipper to make the worker
more reliable, observable, and responsive — without changing its core architecture.

## Phases

- [x] Phase 1: Watcher hardening (debounce + hash cache)
- [x] Phase 2: WebSocket push — replace UI polling with live events
- [x] Phase 3: Process management (timeout watchdog + PID guard + stdout capture)
- [x] Phase 4: Config hot-reload + sync state machine
- [x] Phase 5: Parallel limit enforcement & workflowConfig scope fix (2/27/2026)

## Hotfixes Applied

### Bug: Worker crashes on process exit with `ReferenceError: workflowConfig is not defined`
- **Root Cause**: `workflowConfig` was a local variable inside the setInterval callback, but referenced in async `proc.on('exit')` handlers that run much later, causing it to be out of scope.
- **Fix**: Moved `workflowConfig` to module-level, initialized at startup, updated in auto-launch loop.

### Bug: Parallel limits not enforced after worker restart
- **Root Cause**: `activePerLane` object was created fresh each iteration (every 5s), tracking only tracks claimed in that single iteration. When iteration N+1 ran before iteration N's track finished, it had no memory of the running track, allowing multiple tracks from the same lane to spawn simultaneously.
- **Fix**: Added `runningLaneMap` to persistently track which lane each running PID belongs to. Count currently running tracks per lane before claiming new ones.
- **Impact**: Now properly respects `parallel_limit` in workflow config (e.g., max 1 planning track at a time).

These issues prevented the worker from maintaining lane isolation after restart and caused fatal crashes during normal operation.
