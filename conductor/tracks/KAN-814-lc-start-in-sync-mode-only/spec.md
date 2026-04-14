# Spec: Worker Mode Configuration (Sync vs Sync+Poll)

## Problem Statement

Currently, the sync worker (`laneconductor.sync.mjs`) always operates in **sync+polling** mode — it continuously:
1. Syncs filesystem ↔ database (chokidar + 5s heartbeat)
2. Polls the queue for pending tracks
3. Claims and auto-runs tracks from the queue

This works well for hands-off automation, but some users want to:
- Run the worker **sync-only** (filesystem↔database sync only)
- Manually trigger track actions via `/laneconductor implement`, `/laneconductor review`, etc.
- Avoid auto-claiming tracks from the queue

**Use case**: Developers who want fine-grained control over when work runs, or who are using the CLI directly without the Kanban UI.

## Requirements

**REQ-1: Worker Mode Configuration**
- Add `worker.mode` field to `.laneconductor.json`
- Valid modes: `"sync"` (sync-only), `"sync+poll"` (default)
- If omitted, default to `"sync+poll"` for backward compatibility

**REQ-2: CLI Flag Support**
- `lc start` — start in default mode (from config)
- `lc start --sync-only` — override config, start in sync-only mode
- Both modes stored in the running worker's state for UI display

**REQ-3: Sync Worker Behavior**
- **sync-only mode**:
  - Watch filesystem (chokidar) and sync to DB ✓
  - Poll 5s heartbeat for DB→FS queue changes ✓
  - **DO NOT** poll the track queue
  - **DO NOT** auto-claim tracks
  - **DO NOT** auto-run tracks

- **sync+poll mode** (default):
  - Watch filesystem and sync to DB ✓
  - Poll 5s heartbeat for DB→FS queue changes ✓
  - **DO** poll the track queue every 5s ✓
  - **DO** claim available tracks (git lock) ✓
  - **DO** auto-run tracks ✓

**REQ-4: UI Visibility**
- Display current worker mode in the Workers list (e.g., "Syncing only" vs "Syncing + Running")
- Show mode in worker status badge or worker details card
- Allow UI to filter/sort by mode

**REQ-5: Backwards Compatibility**
- Existing `.laneconductor.json` files without `worker.mode` default to `"sync+poll"`
- Existing workflows unchanged — users must explicitly opt into sync-only

## Acceptance Criteria

- [ ] `.laneconductor.json` schema includes `worker.mode` field (optional, defaults to `"sync+poll"`)
- [ ] `lc start` command respects the mode from config
- [ ] `lc start --sync-only` flag overrides config and starts in sync-only mode
- [ ] Sync worker in sync-only mode skips queue polling and auto-run logic
- [ ] Sync worker in sync+poll mode retains current behavior
- [ ] UI displays worker mode in Workers list
- [ ] Tests verify both modes work correctly
- [ ] Documentation updated with mode descriptions and CLI examples

## Technical Constraints

- Mode is a **runtime choice**, not a schema change (no DB migration required)
- Mode is stored in-process during worker lifetime (not persisted to DB)
- Mode is **worker-specific**, not project-specific (multiple workers can have different modes)
- Sync-only workers can still write files locally — only the queue-polling/auto-run is disabled
