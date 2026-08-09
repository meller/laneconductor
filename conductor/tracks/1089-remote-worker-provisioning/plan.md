# Plan: Remote Worker Provisioning (Track 1089)

## Phase 1: Schema

**Problem**: No registry of machines a developer could start a worker on.
**Solution**: `provision_targets` table.

- [ ] Task 1: Migration — `provision_targets` table (see spec REQ-1)

## Phase 2: API

**Problem**: Nothing can register a target host or create a provisioning
dispatch entry yet.
**Solution**: CRUD for targets + reuse of 1085's project-level dispatch
endpoint.

- [ ] Task 1: `POST/GET/DELETE /api/projects/:id/provision-targets`
- [ ] Task 2: Confirm `POST /api/projects/:id/dispatch` (from 1085) accepts `action: 'provision-worker'` with the `{target_host, worker_number}` payload shape — extend its validation if needed (e.g. reject if `target_host` isn't a registered `provision_targets` entry)

## Phase 3: Worker-Side Stub Handler

**Problem**: SSH execution is deferred (FFU) — need an honest placeholder,
not silence.
**Solution**: Stub handler in the dispatch loop for `provision-worker`.

- [ ] Task 1: On claiming a `provision-worker` entry, log `[provision-worker] SSH execution not yet implemented — target: <host>, would run: lc worker start --worker-number <n>`
- [ ] Task 2: Mark the dispatch `failed` with that message as the failure reason

## Phase 4: UI

**Problem**: No way to register targets or trigger provisioning from the app.
**Solution**: `+ New Worker` flow on the Workers list.

- [ ] Task 1: `+ New Worker` button on Workers list
- [ ] Task 2: Target host picker — existing `provision_targets` entries + inline "add new" (host + label)
- [ ] Task 3: Launcher worker picker — the developer's own online workers only (`workers.user_uid`)
- [ ] Task 4: `Provision` button — creates the dispatch entry, shows resulting status inline (including the expected "not yet implemented" failure)

## Phase 5: Tests

- [ ] Task 1: Provision target CRUD
- [ ] Task 2: Dispatch entry created with correct action/payload shape
- [ ] Task 3: Stub handler produces the expected `failed` status + message, visible via the dispatch history endpoint
- [ ] Task 4: No SSH-related code path is exercised (confirms nothing silently attempts a real connection in this pass)
