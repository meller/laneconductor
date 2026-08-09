# Track 1089: Remote Worker Provisioning

**Lane**: plan
**Lane Status**: success
**Progress**: 0%
**Phase**: Planning complete
**Type**: dev
**Summary**: Activate a worker on an already-known remote machine from the app, delegated through an existing worker — SSH execution itself deferred (FFU).

## Problem

Every worker today has to be started manually via `lc worker start` on
whatever machine it runs on — there's no way to say "start a new worker on
that other machine" from the app itself, the closest analog to how Claude
Code/Antigravity let you open a new agent session with one click.

Not in scope: actual cloud compute provisioning (spinning up new VMs/
containers). That's a materially bigger, different feature — cloud account,
billing, image/container build, security hardening. This is about
activating a worker on a machine the user already controls and already has
LaneConductor installed on.

## Solution

- `provision_targets (id, project_id, user_uid, host, label, created_at)` —
  a lightweight registry of "machines I could start a worker on," distinct
  from `workers` (which only exist once a worker has actually registered).
- No new credential storage anywhere: the Collector API never holds SSH
  access itself. Instead this reuses [1085](../1085-manual-worker-dispatch/index.md)'s
  dispatch inbox again — a `provision-worker` action sent to an
  already-running *launcher* worker that has SSH access configured to reach
  the target host (via that worker's own `~/.ssh` config/agent). Bootstrapping
  needs at least one worker already running to launch the rest from. Any of
  the developer's own workers (`workers.user_uid`, track 1084) can be the
  launcher — unlike
  [1091](../1091-manager-worker-and-new-project-flow/index.md)'s
  `create-project`, provisioning stays within an *existing* project (adding
  another worker to it), so it doesn't need 1091's stricter `type: 'manager'`
  gate, which exists specifically because `create-project` has no project to
  scope permission to yet.
- UI: Workers list gets `+ New Worker` → pick a target host (or add a new
  one) + pick a launcher worker → `Provision`. Creates a `worker_dispatch`
  row: `action: 'provision-worker'`, `payload: {"target_host": ...,
  "worker_number": <next available>}` (depends on
  [1084](../1084-worker-identity-and-assignment/index.md)'s
  `--worker-number` stable identity).
- **Explicitly deferred (FFU) in this pass: the actual SSH execution.** The
  launcher worker's handler for `provision-worker` is a stub — logs
  `"[provision-worker] SSH execution not yet implemented — target: <host>,
  would run: lc worker start --worker-number <n>"` and marks the dispatch
  `failed` with that message, visible in the UI. Everything else (registry,
  UI flow, dispatch entry shape) is built for real; only the last step is a
  placeholder.

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md) (Section F)

## Phases
- [ ] Phase 1: Schema — `provision_targets` table
- [ ] Phase 2: API — CRUD for provision targets, dispatch endpoint for `provision-worker`
- [ ] Phase 3: Worker-side stub handler — logs "not yet implemented", marks dispatch failed with a clear message
- [ ] Phase 4: UI — `+ New Worker` flow (target host picker/add, launcher worker picker, Provision button)
- [ ] Phase 5: Tests — target CRUD, dispatch entry creation, stub handler produces the expected failed status + message

## Depends on
[1084](../1084-worker-identity-and-assignment/index.md) — needs `--worker-number` stable identity to assign the new worker a slot. [1085](../1085-manual-worker-dispatch/index.md) — reuses its dispatch inbox and generic `payload` column directly.

## Follow-up (not in this track)
Actually implementing the SSH execution step once this structure is in place and validated.
