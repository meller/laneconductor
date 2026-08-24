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

- [x] **Server restart required**: resolved by normal deployment — not a code issue.

## Phase 6 (2026-08-12, redesigned): Real SSH execution via the manager worker

**Problem**: `provision-worker` is a stub; nothing actually connects to a
remote host. The original design ("any worker can be a launcher," posted
to the existing project-scoped `POST /api/projects/:id/dispatch`) doesn't
actually work for the redesign below — a manager worker's `project_id` is
always `null`, and that endpoint's validation requires the dispatched-to
worker to belong to the given project (`WHERE EXISTS (SELECT 1 FROM
workers WHERE id = $1 AND project_id = $4)`), which a manager can never
satisfy. Needs a global endpoint, mirroring [1091](../1091-manager-worker-and-new-project-flow/index.md)'s
`POST /api/dispatch/create-project`.

**Solution**:

- [ ] Task 1: New global `POST /api/dispatch/provision-worker` (not the
      existing project-scoped one) — validates `worker_id` refers to a
      `type: 'manager'` worker, same shape as `create-project`'s own
      validation. Payload: `{target_host, target_path, worker_number, cli,
      model}`. `target_path` is new (see index.md) — required, since
      there's no way to know where the project lives on a different
      machine without it.
- [ ] Task 2: Manager worker's `provision-worker` handler (replacing the
      stub in `laneconductor.sync.mjs`) — runs
      `ssh -o ConnectTimeout=10 <target_host> "cd <target_path> && lc worker start --worker-number <n>"`
      via the async `exec` (promisified, matching the fix already applied
      to track 1099's CLI probing — **not** `execSync`, which blocks the
      whole event loop for the SSH call's entire duration and would stall
      this manager's other heartbeats/dispatches the same way the model-
      discovery bug did). Sets `updateWorkerHeartbeat('busy', ...)` /
      `'idle'` around the call, matching `create-project`'s convention.
      On success: `status: 'done'`, `result` includes the remote command's
      stdout. On failure (SSH connect failure, remote `lc worker start`
      exits non-zero, or timeout): `status: 'failed'`, `result` includes
      enough of stderr/the error message to actually debug it — not just
      "failed."
- [ ] Task 3: Test-only SSH mocking — introduce `LC_MOCK_SSH`, matching
      this codebase's existing `LC_MOCK_CLI` convention (used throughout
      tracks 1084/1085/1091's own integration tests): when set, the
      manager's `ssh ...` invocation is replaced with a configurable mock
      script instead of a real network call, so this can be tested via a
      real spawned manager-worker process (matching how
      `track-1091-create-project-worker.test.mjs` verifies `create-project`
      end-to-end) without needing real remote infrastructure.
- [ ] Task 4: `ProvisionWorkerModal.jsx` — add required "Remote Project
      Path" field; filter the "Launcher Worker" picker to
      `type === 'manager'` only (today it lists every non-offline worker);
      point the submit at the new global endpoint instead of the
      project-scoped one.
- [ ] Task 5: Restore the `+ New Worker` entry point in `WorkersList.jsx`
      (hidden 2026-08-11 while this was a stub).
- [ ] Task 6: Tests — global endpoint's manager-only validation (mirrors
      `create-project`'s own test file), worker-side handler's success/
      failure/timeout paths via `LC_MOCK_SSH`, and an update to
      `ProvisionWorkerModal`'s existing tests for the new field + launcher
      filtering.

### Phase 6 outcome (2026-08-12) — SSH dropped entirely, implemented and verified live

**The design above was itself replaced mid-implementation.** SSH was built
and passing tests when the simpler question surfaced: why SSH at all? The
dispatch inbox is *outbound-polling*, so any machine that should run
workers already has a manager polling from it — and that manager can start
the worker locally. "Provision on machine X" is therefore just "dispatch to
X's manager." No inbound network path, no credentials, no shell quoting, no
reachability/timeout handling, and it works through NAT/firewalls. The only
thing SSH bought was provisioning a machine with no manager yet — but the
track already assumes LaneConductor is installed there, and if you can
install it you can run `lc worker start --manager` once. The SSH
implementation (handler, `LC_MOCK_SSH` harness, host/path form fields) was
deleted rather than kept as a second parallel mechanism.

**Shipped:**
- `POST /api/dispatch/provision-worker` — global, manager-only (a manager's
  `project_id` is null, so the project-scoped dispatch endpoint can never
  validate it). Payload: `{project_name, project_id, repo_path, cli, model}`.
  5 tests.
- Worker-side handler resolves the project folder in priority order:
  `repo_path` (authoritative, correct whenever the project is where the DB
  says on this machine — the common case) → `<projectsDir>/<basename(repo_path)>`
  → `<projectsDir>/<slug(project_name)>`. The slug guess is last precisely
  because real folder names often don't match a slugified display name
  ("FiveElements" lives in `5elements/`). Failure lists *every* path tried,
  so the user can see why without reading worker logs. 2 tests (both
  failure paths — the success path shells out to a real `lc worker start`,
  covered by the live verification below instead).
- Modal reduced to its two real choices — project and machine — plus
  CLI/model. Manager-only picker; "no manager" empty state explains the
  one-time `lc worker start --manager --projects-dir <path>` bootstrap.
- `+ New Worker` entry point restored (hidden 2026-08-11 while stubbed).

**Verified live in the browser**, not just by tests: provisioned a worker
for the real `macrodash` project via the UI → `Status: done`, "Started
worker #1 for "macrodash" at /home/meller/Code/macrodash", real PID, and
the new worker appeared registered in the workers list.

- [ ] **Known gap, not fixed**: the modal's CLI/Model pickers don't affect
      the provisioned worker. `lc worker start` has no `--cli`/`--model`
      flags — a worker reads them from its project's own
      `.laneconductor.json`. Confirmed live: picked "Claude Sonnet 5",
      worker registered as `claude/haiku` (macrodash's configured values).
      Either add the flags to `lc worker start` and pass them through, or
      drop the pickers from this modal and point users at the existing
      "Change Model" control on the worker card (track 1096) instead.
      Leaving a control that silently does nothing is the worse option.
- [ ] **Minor**: `laneconductor.sync.mjs --projects-dir <path>` is silently
      ignored — only `lc worker start --manager --projects-dir` works,
      since the flag is consumed by `bin/lc.mjs`, which writes
      `~/.laneconductor/manager-config.json` (what the worker actually
      reads). Hit this during live verification. Either accept the flag in
      the worker too, or reject it with a message pointing at `lc`.
- [ ] **Stale-default bug found and fixed in passing**: both
      `ProvisionWorkerModal` and `WorkerModelModal` hardcoded an initial
      model id (`claude-sonnet-4-5` and `claude-3-5-sonnet`) while
      `MODEL_PRESETS` already led with Sonnet 5 — so the pickers defaulted
      to an old model and would silently rot again on every preset update.
      Both now default to the first preset (the recommended one).
