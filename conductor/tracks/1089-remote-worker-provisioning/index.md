# Track 1089: Remote Worker Provisioning

**Lane**: done
**Lane Status**: success
**Progress**: 95%
**Phase**: Phase 6 implemented and verified live 2026-08-12 — and SSH was dropped entirely along the way (see Solution). Starting a worker on another machine is now just a dispatch to that machine's own…
**Type**: dev
**Summary**: Start a worker for a project on whichever machine should run it, dispatched to that machine's manager worker. No SSH: the dispatch inbox is outbound-polling, so the machine already has a manager…

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
- **No SSH at all — redesigned twice, 2026-08-12.** Originally "any of the
  developer's own workers can be the launcher, over SSH"; then "the
  **manager** worker ([1091](../1091-manager-worker-and-new-project-flow/index.md))
  does the SSH"; finally: no SSH whatsoever. The dispatch inbox
  ([1085](../1085-manual-worker-dispatch/index.md)) is **outbound-polling** —
  so any machine that should run workers *already has a manager polling
  from it*, and that manager can simply start the worker locally.
  "Provision on machine X" is therefore just "dispatch to X's manager."
  No inbound network path, no credentials, no reachability/timeout
  handling, and it works through NAT and firewalls. The only thing SSH
  bought was provisioning a machine with no manager yet — but this track
  already assumes LaneConductor is installed there, and if you can install
  it you can run `lc worker start --manager` once. That one-time bootstrap
  is no more work than setting up SSH keys, and it avoids maintaining a
  second parallel mechanism.
- Manager-only, for the same reason `create-project` is: a manager is the
  machine-level singleton the user explicitly started as "the thing that
  does system-wide actions." A regular project worker has no business
  starting workers for other projects. Since there's at most one manager
  per machine, **picking the manager *is* picking the machine**.
- UI: Workers list `+ New Worker` → pick a project + pick a machine →
  `Start Worker`. Creates a `worker_dispatch` row:
  `action: 'provision-worker'`, `worker_id: <a manager worker>`,
  `payload: {project_name, project_id, repo_path, cli, model}` — no host,
  no path input. The manager resolves the project folder itself:
  `repo_path` first (authoritative whenever the project is where the DB
  says on that machine), then `<projectsDir>/<basename(repo_path)>`, then
  `<projectsDir>/<slug(project_name)>`. Failure lists every path tried.
- Bootstrapping needs a manager already running on each machine that
  should run workers — the same bootstrap requirement `create-project`
  already has.

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md) (Section F) — note the redesign above supersedes that doc's "any worker can launch" framing.

## Phases
- [x] Phase 1: Schema — `provision_targets` table
- [x] Phase 2: API — CRUD for provision targets, dispatch endpoint for `provision-worker` (superseded in Phase 6 by the global, manager-only `POST /api/dispatch/provision-worker`)
- [x] Phase 3: Worker-side stub handler — replaced by Phase 6's real implementation
- [x] Phase 4: UI — `+ New Worker` flow (rebuilt in Phase 6: project + machine only, no SSH host/path)
- [x] Phase 5: Tests — target CRUD, dispatch entry creation, stub handler produces the expected failed status + message
- [x] Phase 6 (2026-08-12): Provisioning via the target machine's own manager, no SSH — implemented and verified live in the browser. Two known gaps remain open, see plan.md.

## Depends on
[1084](../1084-worker-identity-and-assignment/index.md) — needs `--worker-number` stable identity to assign the new worker a slot. [1085](../1085-manual-worker-dispatch/index.md) — reuses its dispatch inbox and generic `payload` column directly. [1091](../1091-manager-worker-and-new-project-flow/index.md) — Phase 6 now runs through the manager worker it introduced, not a generic "any worker" launcher.
