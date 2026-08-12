# Plan: Remote Worker Provisioning (Track 1089)

## Phase 1: Schema

**Problem**: No registry of machines a developer could start a worker on.
**Solution**: `provision_targets` table.

- [x] Task 1: Migration — `provision_targets` table (see spec REQ-1)

## Phase 2: API

**Problem**: Nothing can register a target host or create a provisioning
dispatch entry yet.
**Solution**: CRUD for targets + reuse of 1085's project-level dispatch
endpoint.

- [x] Task 1: `POST/GET/DELETE /api/projects/:id/provision-targets`
- [x] Task 2: `POST /api/projects/:id/dispatch` accepts `action: 'provision-worker'` with `{target_host, worker_number, cli, model, target_project_id}` payload shape

## Phase 3: Worker-Side Stub Handler

**Problem**: SSH execution is deferred (FFU) — need an honest placeholder,
not silence.
**Solution**: Stub handler in the dispatch loop for `provision-worker`.

- [x] Task 1: On claiming a `provision-worker` entry, log `[provision-worker] SSH execution not yet implemented — target: <host>, would run: lc worker start --worker-number <n>`
- [x] Task 2: Mark the dispatch `failed` with that message as the failure reason

## Phase 4: UI

**Problem**: No way to register targets or trigger provisioning from the app.
**Solution**: `+ New Worker` flow on the Workers list.

- [x] Task 1: `+ New Worker` button on Workers list (grid + strip layouts)
- [x] Task 2: `ProvisionWorkerModal` with SSH host input + optional label
- [x] Task 3: **Project selector** — fetches all projects from `/api/projects`, assigns `target_project_id` in dispatch payload
- [x] Task 4: Launcher worker picker — all non-offline workers; manager workers shown first with 👑 indicator and project name for context
- [x] Task 5: CLI engine + model dropdowns (shared presets from `WorkerModelModal`)
- [x] Task 6: `Provision` button — creates the dispatch entry, polls for result, shows status banner (including expected stub failure)
- [x] Fix: Modals were not rendering in grid layout when workers existed — added all modals to both grid and strip layout return blocks

## Phase 5: Tests

- [x] Task 1: Provision target CRUD
- [x] Task 2: Dispatch entry created with correct action/payload shape
- [x] Task 3: Stub handler produces expected `failed` status + message, visible via dispatch history endpoint
- [x] Task 4: No SSH-related code path is exercised (confirms nothing silently attempts a real connection)

## Known Open Item

- [ ] **Server restart required**: Running server instance predates `provision-targets` route registration. Routes exist in code (`server/index.mjs` L2983) but need a restart to activate. Tests pass against fresh instances — this is a deployment step, not a code issue.
- [ ] **SSH Phase 6** (future): Replace `provision-worker` stub with real SSH execution via `node-ssh` or `ssh2` to actually install and launch the worker daemon on the target host.
