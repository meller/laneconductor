# Spec: Three Operating Modes

## Problem Statement
LaneConductor workers operate in three distinct modes depending on infrastructure availability. These modes are now implemented but not documented or consistently tested.

## Three Modes

### Mode 1 — local-fs (Offline / Testing)
**When**: `config.mode: "local-fs"` OR no `collectors` array in `.laneconductor.json`
**How it works**:
- Worker reads `conductor/workflow.json` for lane config
- Scans `conductor/tracks/*/index.md` for `**Lane Status**: queue` tracks
- Enforces `parallel_limit` per lane using in-process `runningPids` tracking
- On completion: updates `**Lane**` and `**Lane Status**` markers in `index.md`
- Retry counts stored in `.retry-count` files alongside `index.md`
- `on_success` / `on_failure` transitions applied via file writes
- No HTTP calls, no DB, no git locking required

**Use cases**: Offline development, CI pipelines, testing, air-gapped machines

### Mode 2 — local-api (Local Full Stack)
**When**: `collectors[0].url` contains `localhost` or `127.0.0.1`
**How it works**:
- Worker syncs track state to local Collector API (`:8091`)
- Local Postgres DB stores canonical state
- Vite dashboard at `:8090` shows live Kanban
- `claim-queue` endpoint for distributed worker coordination
- Git locks for multi-worker safety

**Use cases**: Solo developer, full local setup with UI, testing real coordination

### Mode 3 — remote-api (Cloud / Team)
**When**: `collectors[0].url` is a remote URL
**How it works**:
- Same as local-api but collector is remote (laneconductor.io or self-hosted)
- Multi-machine workers coordinate via remote DB
- Team can view dashboard from anywhere

**Use cases**: Team development, cloud-hosted, multi-machine

## Mode Detection Logic
```javascript
const MODE = config.mode
  ?? (!collectors?.length ? 'local-fs'
    : (url.includes('localhost') ? 'local-api' : 'remote-api'));
```

## Requirements
- REQ-1: Mode auto-detected from config; can be overridden with `config.mode`
- REQ-2: Mode 1 must work with zero infrastructure (no postgres, no collector, no internet)
- REQ-3: Mode 1 must correctly enforce `parallel_limit` and `on_success`/`on_failure`
- REQ-4: All three modes documented in product.md and landing page
- REQ-5: Tests for each mode (Mode 1: E2E with mock CLI, Mode 2/3: integration with mock collector)
- REQ-6: local-fs mode should NOT use git locks/worktrees (unnecessary overhead for pure-fs operation)

## Acceptance Criteria
- [ ] `node conductor/tests/local-fs-e2e.test.mjs` passes (6/6)
- [ ] product.md has a "Three Operating Modes" section
- [ ] Mode config documented in SKILL.md
- [ ] local-fs mode produces no git-related errors
- [ ] Mode 2/3 test stubs in place
