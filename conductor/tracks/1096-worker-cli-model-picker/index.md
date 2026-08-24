# Track 1096: Choose/change a worker's CLI + model from the UI

**Lane**: implement
**Lane Status**: running
**Progress**: 90%
**Phase**: Implemented Phase 7 — Start-worker CLI/model picker (course-corrected to reuse track 10011's in-memory --cli/--model mechanism, not a .laneconductor.json write) and the missing heartbeat test. 25/25…
**Type**: dev
**Summary**: No UI exists to choose a worker's CLI/model when starting one, or to change an existing worker's model assignment afterward — today it's CLI-only, via .laneconductor.json's primary/secondary config…

## Problem

Raised while reviewing track 1091 (Manager Worker Type & New-Project Flow)
— out of scope there, since 1091 is specifically about the manager worker
type and new-project flow, not general worker configuration; applies to
every worker, not just manager workers.

Today, a worker's CLI (`claude`/`antigravity`/etc.) and model come from
`.laneconductor.json`'s `project.primary`/`project.secondary` config,
set only via `lc setup`'s CLI wizard or by hand-editing the file. There's
no UI path to:
1. Choose which CLI/model a *new* worker should use when starting one
   from the app.
2. Change an *existing* worker's model assignment afterward, without
   editing `.laneconductor.json` directly and restarting the worker.

## Plan Checklist

### Phase 1: Database Migration & API Server Support
- [ ] Task 1.1: Create database migration adding `cli` and `model` columns to `workers` table.
- [ ] Task 1.2: Update `POST /worker/register` and `PATCH /worker/heartbeat` in `ui/server/index.mjs` to receive, validate, and store `cli` and `model`.
- [ ] Task 1.3: Update `GET /api/workers` and `GET /api/projects/:id/workers` queries in `ui/server/index.mjs` to include `w.cli` and `w.model`.
- [ ] Task 1.4: Implement `PATCH /api/workers/:id/config` endpoint in `ui/server/index.mjs` to update worker config and dispatch `set_model` action to `worker_dispatch`.

### Phase 2: Worker Daemon Sync Engine
- [ ] Task 2.1: Update worker heartbeat payload in `conductor/laneconductor.sync.mjs` to include CLI engine name and active model.
- [ ] Task 2.2: Add dispatch action handler for `set_model` in `conductor/laneconductor.sync.mjs` to update in-memory active model without process restart.

### Phase 3: UI Components & Model Picker Modal
- [ ] Task 3.1: Create `WorkerModelSelectorModal.jsx` component offering selectable model options per provider (Claude, Gemini, Copilot, Antigravity) + custom model text input.
- [ ] Task 3.2: Update `WorkersList.jsx` card (grid) and pill (strip) layouts to render CLI icon/badge and model tag.
- [ ] Task 3.3: Add "Change Model" button to worker cards in `WorkersList.jsx` to launch `WorkerModelSelectorModal`.
- [ ] Task 3.4: Connect modal submit to `PATCH /api/workers/:id/config` with WebSocket refresh broadcast.

### Phase 4: Integration Testing & Verification
- [ ] Task 4.1: Write integration test suite `ui/server/tests/track-1096-worker-model-picker.test.mjs` testing register, heartbeat, patch config, and GET worker routes.
- [ ] Task 4.2: Perform browser verification of Workers View model selector UI and live state updates.

## Depends on

Possibly related to [1089](../1089-remote-worker-provisioning/index.md)
(activating a worker on a remote machine from the app) and
[1091](../1091-manager-worker-and-new-project-flow/index.md) (new-worker
creation flow) — worth checking during planning whether this should be a
shared step in both rather than fully separate.
**Waiting for reply**: yes
