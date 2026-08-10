# Plan: Manager Worker Type & New-Project Flow (Track 1091)

## Phase 1: Schema

**Problem**: No way to distinguish a worker trusted for system-wide actions
from a normal per-project worker.
**Solution**: `workers.type` column.

- [x] Task 1: Migration — `ALTER TABLE workers ADD COLUMN type TEXT DEFAULT 'project'`, make `project_id` nullable
- [x] Task 2: Migration — partial unique index `workers_one_manager_per_host ON workers (hostname) WHERE type = 'manager'`
- [x] Task 3: API validation — `create-project` dispatch creation rejects a `worker_id` whose `type != 'manager'`

**✅ Phase 1 complete (2026-08-10).**

**Task 1 — spec correction found before writing any migration**: checked
the real DB first (`\d workers`) rather than trusting spec.md's premise —
`project_id` was **already nullable** (no `NOT NULL` constraint exists on
it), so "make it nullable" needed no migration work at all. Only the
`type TEXT NOT NULL DEFAULT 'project'` column was actually needed.
Generated via `atlas migrate diff add_workers_type --env local`
(`migrations/20260810140302_add_workers_type.sql`), applied directly to
the real DB, confirmed zero drift afterward.

**Task 2 — manually verified the actual constraint, not just its SQL**:
`workers_one_manager_per_host` on `(hostname) WHERE type = 'manager'`. A
plain unique constraint on `(project_id, hostname)` would NOT work here —
Postgres treats every `NULL` as distinct in uniqueness checks, and a
manager's `project_id` is always null, so multiple manager rows would
never collide under that. Confirmed the real behavior in a rolled-back
transaction against the real DB: two `type: 'manager'` inserts on the same
hostname → second one fails with the expected constraint violation; two on
different hostnames → both succeed.

**Task 3**: new `POST /api/dispatch/create-project` — deliberately a new,
project-**un**scoped endpoint, not a reuse of
`POST /api/projects/:id/dispatch` (deploy) or `POST /api/tracks/:id/dispatch`
(lane actions): both of those validate the calling worker against an
*existing* project's id, which doesn't fit here — a manager worker's own
`project_id` is null, and `create-project`'s whole point is there's no
project to scope to yet. Validates `worker_id` exists and is
`type: 'manager'` before inserting into `worker_dispatch`
(`track_number: null`, `action: 'create-project'`). 5 Vitest tests
(`ui/server/tests/track-1091-manager-dispatch.test.mjs`), following this
file's established test conventions (mocked `pg`, `supertest`).

## Phase 2: CLI

**Problem**: No way to start a worker as a manager, and no protection
against accidentally starting a second one on the same machine.
**Solution**: `--manager` flag on `lc worker start`, with a clear failure
if one's already running there.

- [x] Task 1: `lc worker start --manager` — `POST /worker/register` sends `type: 'manager'`, `project_id: null`
- [x] Task 2: Registration fails clearly (not silently) if the unique index rejects a second manager for this hostname — surface the existing manager's PID in the error
- [x] Task 3: Confirm combinability with existing `--sync-only`/`--worker-number` flags (1084) for `'project'`-type workers; `--worker-number` is meaningless for `--manager` (machine-level singleton, not multi-instance)
- [x] Task 4 (added 2026-08-10, spec.md REQ-2b): `--projects-dir <path>` — required before any `create-project` dispatch involving a git clone can succeed; persisted to `~/.laneconductor/manager-config.json` on first start so restarts don't need to repeat it, updatable by passing the flag again

**✅ Phase 2 complete (2026-08-10).**

**Task 1**: `laneconductor.sync.mjs` parses `--manager` from `process.argv`
(new `isManager` const, alongside the existing `--worker-number` parsing);
`upsertWorker()` skips `/project/ensure` entirely when `isManager` (a
manager isn't "for" any project — nothing to ensure) and sends
`{project_id: null, type: 'manager'}`. `POST /worker/register` gained a
dedicated manager branch — a genuinely separate `INSERT ... ON CONFLICT
(hostname) WHERE type = 'manager'` query, not a variant of the existing
`(project_id, hostname, worker_number)` path, since Postgres treats every
`NULL` project_id as distinct and that constraint would never fire for a
second manager. Verified against a real spawned worker process (not a
mock): registers with the right shape, `/project/ensure` call count stays
zero.

**Task 2 — found and fixed a real, pre-existing bug while verifying
this**: `lc worker start --manager`'s "already running" rejection printed
the right message but **always exited 0** regardless. Root cause: `lc
worker start` forwards to a child process (`spawnSync('node', [__filename,
'start', ...])`) and the wrapper called `process.exit(0)` unconditionally
right after, discarding the child's actual exit code — a bug that
predates this track and affected `start`/`stop`/`restart`/`logs`/`sync`
uniformly, not just `--manager`. Fixed by propagating `spawnSync`'s
`.status` for all five forwarded subcommands, not just the one this task
happened to need. Verified live: a second `lc worker start --manager`
against a real running one now correctly prints the error **and** exits
1; `lc worker stop --manager` then `lc worker start --manager` again
correctly succeeds (exit 0) once the first is genuinely gone.

**Task 3**: `--sync-only` combines cleanly (used throughout every manual
verification here). `--worker-number` is a structural no-op for
`--manager` — the manager branch in both `bin/lc.mjs` and
`laneconductor.sync.mjs` never reads it, by construction, rather than
needing an explicit rejection.

**Task 4**: `getManagerConfigPath`/`readManagerConfig`/`writeManagerConfig`
in `bin/lc.mjs`, backing `~/.laneconductor/manager-config.json` —
`laneconductor.sync.mjs` will read this same file directly at Phase 3
(matching this codebase's existing pattern for global config,
`~/.laneconductorrc`/`~/.laneconductor-auth.json`, rather than threading
it through as a spawn arg). Verified live: `--projects-dir /tmp/x` on
first start persists it; a later start without the flag prints "(from
previous run)" and reuses the stored value.

**Environment note, not part of this track but found while verifying
it**: hit a system-wide `fs.inotify.max_user_instances` (128) exhaustion
that made every chokidar-based worker process — mine and several
pre-existing tests — fail with `EMFILE`. Root-caused (not guessed): ~67 of
128 instances traced to Antigravity editor/CLI/language-server processes
accumulated over time, not this track's own code. Resolved by raising the
limit to 256 (user's own machine, user ran the sysctl command).

## Phase 3: Worker-Side Handler

**Problem**: Nothing executes a `create-project` dispatch yet.
**Solution**: Manager-worker-only handler in the dispatch loop, reusing
existing scaffold-generation logic rather than rebuilding it.

- [x] Task 1: Dispatch loop only claims `create-project` entries when this worker's own `type === 'manager'`
- [x] Task 2: Resolve `payload.repo_source` — existing local path, or `git clone` from a URL
- [x] Task 3: Write `conductor/.setup-scaffold-context.json` from `payload.scaffold_context`
- [x] Task 4: Run `/laneconductor setup scaffold generate` against the resolved location (existing skill command, unmodified)
- [x] Task 5: Spawn `lc worker start` at the new location, which self-registers (`type: 'project'`, default) via the existing `upsertWorker()`/`/project/ensure`/`/worker/register` pipeline — not a direct SQL insert (this worker never touches Postgres directly, only through the Collector API)
- [x] Task 6: If `repo_source.target_machine` names a different machine than this manager worker's own hostname, reject with a clear error citing 1089 (remote provisioning), which doesn't exist yet, rather than silently registering a local worker

**✅ Phase 3 complete (2026-08-10).** Worktree-isolated (`.worktrees/1091`,
branch `track-1091`) — see the "Worktree isolation" note on index.md for
why, starting this phase.

`runCreateProject()`, wired into `checkDispatchInbox`'s existing loop
behind an `isManager` guard (defense-in-depth alongside Task 1's own
dispatch-loop check). Pure helper logic (`slugify`, `resolveRepoTarget`)
extracted to `conductor/create-project-utils.mjs` for unit testing, since
`laneconductor.sync.mjs` runs side effects at import time.

**Task 5 — deliberately not a direct SQL insert**: spawns a normal `lc
worker start` at the target instead, reusing the exact registration
pipeline every other project already goes through, rather than
duplicating it. The new project's `.laneconductor.json` is written with
its collectors' `machine_token` stripped (it's the *manager's* own
resolved auth credential, added to the manager's config by its own
`upsertWorker()` — the new worker must register fresh and get its own,
not start out authenticating as the manager).

**Verification (real spawned worker, not a mock of the handler)**:
`conductor/tests/track-1091-create-project-worker.test.mjs` spawns a real
manager worker against a mock collector, enqueues a `create-project`
dispatch (`repo_source.type: 'path'`), and asserts against the real
filesystem/process outcome — scaffold context file written, new
`.laneconductor.json` correct, a live worker process running at the
target, dispatch reports `status: 'done'`.

**Bug caught during verification, in the test itself, not the source**:
first draft asserted the final `.laneconductor.json` had no
`machine_token` at all. Failed — investigated with a temporary debug log
rather than guessing, which showed `config.collectors` already carried
`machine_token: 'mock-token'` by the time the assertion ran. Root cause:
not the write in `runCreateProject` (confirmed correct — it strips
`machine_token` and, per the log, writes before the new worker is even
spawned) but a race with the *newly-spawned worker's own* `upsertWorker()`
call, which legitimately re-registers itself moments later and persists
its own resolved token back into its own config file — the exact same
thing every worker does, including the manager. Fixed the test, not the
source: it now asserts on the mock collector's registration log (2
distinct `/worker/register` calls, second one `type !== 'manager'`) — the
actual claim "registers fresh, doesn't inherit the manager's token" is
about a registration happening, not about a snapshot of file content
that's inherently racy against a background process.

## Phase 4: UI

**Problem**: No app-level entry point for creating a new project.
**Solution**: "New Project" flow, top-level (not inside an existing
project).

- [x] Task 1: "New Project" entry point in the app shell
- [x] Task 2: Collect project name, repo source (existing path or git URL), and scaffold answers (form-style — resolved 2026-08-10, see index.md's "Open question" and spec.md REQ-5)
- [x] Task 3: Manager worker picker (if more than one available)
- [x] Task 4: Dispatch on submit; show creation progress/result (own lightweight status view — see note below on why not 1087's transcript view)

**✅ Phase 4 complete (2026-08-10).** `ui/src/components/NewProjectModal.jsx`
(new), wired into `App.jsx`'s header next to the existing "+ Track"/"⚠ Bug"
buttons (`+ Project`). Backend: `GET /api/dispatch/:dispatchId` (new,
global like its `POST` counterpart from Phase 1 — polled every 2s while a
dispatch is pending/claimed).

**Task 4 — not 1087's transcript view, by design**: 1087's dispatch log
viewer (`GET /api/projects/:id/dispatch/:dispatchId/log`) is
project-scoped and deploy-specific (reads `conductor/logs/deploy-*.log`
from an *existing* project's `repo_path`). A `create-project` dispatch has
neither — no project exists yet to scope the URL to, and its "log" is just
the terse `result` string `runCreateProject()` returns (`worker_dispatch`
Phase 3 wrote no separate structured log file for a plain scaffold run).
The modal's own status view (`status` + `result` text) is the right size
for what this dispatch actually produces; reusing 1087's view would have
meant either bending it to accept `project_id: null` or building a second
un-project-scoped log file it doesn't need.

**Real bug found and fixed during live verification, not by inspection**:
started a real manager worker registered against a real (scratch) API
instance and clicked through the actual wizard in a browser rather than
just unit-testing the pieces. The manager **vanished from `GET
/api/workers` about 60 seconds after registering**, even though the
process was alive and heartbeating the whole time. Root-caused (not
guessed) by reading `updateWorkerHeartbeat()`'s request body live via the
worker's own debug logs: it unconditionally sent `project_id: proj.id`
(whatever project block happens to be in `.laneconductor.json`, garbage
for a manager) — and independently, even after fixing that to send `null`
for a manager, the server's `PATCH /worker/heartbeat` and `DELETE /worker`
handlers both did `WHERE project_id = $1`, and SQL's `NULL = NULL` is
never true, so a manager's heartbeat (and its graceful-shutdown
de-registration — this is also what the "[worker error] de-registration
failed" warning at the end of every Phase 3 test run actually was, not
investigated at the time) silently matched and updated **zero rows**,
every single time. Two-part fix, both required:
1. `laneconductor.sync.mjs`'s `updateWorkerHeartbeat()`: `project_id:
   isManager ? null : proj.id` (mirrors the existing `isManager` check
   already in `upsertWorker()`'s registration body).
2. `ui/server/index.mjs`: `WHERE project_id = $1` → `WHERE project_id IS
   NOT DISTINCT FROM $1` in both `PATCH /worker/heartbeat` and `DELETE
   /worker` — Postgres's NULL-safe equality operator, behaves identically
   to `=` for non-null values.

Verified live end-to-end after the fix: registered a real manager worker,
confirmed its heartbeat's `last_heartbeat` kept advancing past the
60-second window (previously froze at registration time), submitted the
actual New Project form in a browser, watched the dispatch go
pending → claimed → done via real polling, and confirmed the resulting
`.laneconductor.json`/scaffold context/new worker process on disk matched
what was submitted. Regression tests added
(`ui/server/tests/track-1091-phase4-dispatch-status.test.mjs`) asserting
both handlers' queries use `IS NOT DISTINCT FROM`.

**REQ-5b (multi-machine empty state), added during this phase**: see
spec.md. The "no manager worker" empty state now lists known hostnames
(distinct hostnames across *all* registered workers, not just managers)
so a user with multiple machines connected knows which one(s) to actually
run `lc worker start --manager` on, instead of a context-free "none
available." Known limitation: a machine with zero workers of any kind
registered is invisible to this — there's no separate device-discovery
mechanism in this codebase, and building one is out of scope here.

**Also fixed in passing**: `GET /api/workers` used an inner `JOIN
projects` — since a manager's `project_id` is NULL, this silently excluded
every manager worker from the endpoint entirely, which both this phase's
picker and Phase 5's badge work depend on. Changed to `LEFT JOIN`, added
`w.type` to the SELECT list.

## Phase 5: Visual Distinction for Manager Workers

**Problem**: Added 2026-08-10, during track 1087's Phase 5/6 work — every
worker in the Workers list and the cross-worker activity latch
(`WorkerActivityLatch.jsx`, 1087) renders identically today (a status dot
+ hostname/project). Once `workers.type` (Phase 1) exists, a manager
worker (`project_id: null`, not scoped to any single project) needs its
own visual treatment — showing it next to per-project workers with no
distinction would be confusing (it doesn't belong to "a project" the way
the others do, and it's the one worker type trusted for system-wide
actions like `create-project`).
**Solution**: A distinct badge/icon for `type: 'manager'` rows wherever
workers are listed.

- [ ] Task 1: `WorkersList.jsx` — manager rows get a distinct badge (e.g. "MANAGER", different color from the existing per-project worker styling) instead of a project name (they have none)
- [ ] Task 2: `WorkerActivityLatch.jsx` (1087) — same badge treatment in the worker-list column; a manager worker's `current_task` while running `create-project` should route to 1087's non-track dispatch view (Phase 6 there), not the track-transcript path
- [ ] Task 3: Confirm no regression for `type: 'project'` workers — they keep their existing unbadged rendering (this phase adds a case, doesn't restructure the existing one)

## Phase 6: Tests

- [ ] Task 1: `workers.type` defaults to `'project'`; existing workers/tests unaffected
- [ ] Task 1b: A second `lc worker start --manager` on the same hostname fails clearly and does not register a second row
- [ ] Task 2: `create-project` dispatch to a `type: 'project'` worker is rejected by the API
- [ ] Task 3: A `type: 'project'` worker's dispatch loop never claims a `create-project` entry even if one exists addressed to it (defense in depth)
- [ ] Task 4: End-to-end — New Project UI flow produces a fully scaffolded project and registered `projects`/`workers` rows
- [ ] Task 5: New project's own worker registers with `type: 'project'`, not `'manager'`
- [ ] Task 6: Existing CLI-based (`lc setup`) onboarding path is completely unaffected
- [ ] Task 7: Manager worker badge renders correctly in both `WorkersList.jsx` and `WorkerActivityLatch.jsx` (Phase 5)
