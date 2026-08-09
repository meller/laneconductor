# Spec: Remote Worker Provisioning (Track 1089)

## Problem Statement

Starting a worker requires manually running `lc worker start` on the target
machine — there's no app-level way to activate a worker on a machine you
already control. Full cloud-compute provisioning (spinning up new VMs) is
explicitly out of scope; this is about remotely starting LaneConductor on a
machine that already has it installed.

## Requirements

**REQ-1: Provision targets registry**
- New table `provision_targets (id SERIAL, project_id INTEGER REFERENCES projects(id), user_uid TEXT, host TEXT, label TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`.
- A developer can register any number of target hosts for a project.

**REQ-2: No new credential storage**
- The Collector API never stores or uses SSH credentials. All SSH access
  is delegated to an existing worker (the "launcher") that already has its
  own `~/.ssh` config/agent access to the target host.

**REQ-3: Dispatch reuse**
- Reuses [1085](../1085-manual-worker-dispatch/index.md)'s `worker_dispatch`
  table and generic `payload JSONB` column — no separate mechanism.
- `action: 'provision-worker'`, `worker_id: <launcher worker>`,
  `track_number: null`, `payload: {"target_host": "<host>", "worker_number": <n>}`.
- `worker_number` is the next available slot for that host (simple
  incrementing default is fine — collision handling deferred with the SSH
  execution itself).

**REQ-4: Worker-side stub handler (SSH execution deferred/FFU)**
- On claiming a `pending` `provision-worker` entry, the launcher worker:
  1. Logs `[provision-worker] SSH execution not yet implemented — target:
     <host>, would run: lc worker start --worker-number <n>`.
  2. Marks the dispatch `failed` with that same message as the failure
     reason (visible in the UI's dispatch history — REQ-5).
- No actual SSH connection is attempted in this pass.

**REQ-5: API + UI**
- `POST /api/projects/:id/provision-targets { host, label }` — add a target.
- `GET /api/projects/:id/provision-targets` — list targets.
- `DELETE /api/projects/:id/provision-targets/:id` — remove a target.
- `POST /api/projects/:id/dispatch { worker_id, action: 'provision-worker', payload }`
  — reuses 1085's project-level dispatch endpoint.
- UI: Workers list gets `+ New Worker` → target host picker (existing
  targets + "add new" inline) → launcher worker picker (the developer's own
  online workers only, `workers.user_uid`) → `Provision`. Shows the resulting dispatch's status
  (including the expected `failed` / "not yet implemented" outcome) inline.

## Acceptance Criteria

- [ ] `provision_targets` migration applied; CRUD endpoints work
- [ ] `+ New Worker` flow creates a `worker_dispatch` row with the correct
      `provision-worker` action and payload shape
- [ ] Launcher worker picks up the entry, logs the expected "not yet
      implemented" message, and marks it `failed` with that message
- [ ] UI surfaces the failed status and message clearly — no silent failure
- [ ] No SSH credentials are stored anywhere in the API or DB
