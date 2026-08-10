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

- [ ] Task 1: `lc worker start --manager` — `POST /worker/register` sends `type: 'manager'`, `project_id: null`
- [ ] Task 2: Registration fails clearly (not silently) if the unique index rejects a second manager for this hostname — surface the existing manager's PID in the error
- [ ] Task 3: Confirm combinability with existing `--sync-only`/`--worker-number` flags (1084) for `'project'`-type workers; `--worker-number` is meaningless for `--manager` (machine-level singleton, not multi-instance)
- [ ] Task 4: Omitting the flag registers `type: 'project'` (default, backward compatible)

## Phase 3: Worker-Side Handler

**Problem**: Nothing executes a `create-project` dispatch yet.
**Solution**: Manager-worker-only handler in the dispatch loop, reusing
existing scaffold-generation logic rather than rebuilding it.

- [ ] Task 1: Dispatch loop only claims `create-project` entries when this worker's own `type === 'manager'`
- [ ] Task 2: Resolve `payload.repo_source` — existing local path, or `git clone` from a URL
- [ ] Task 3: Write `conductor/.setup-scaffold-context.json` from `payload.scaffold_context`
- [ ] Task 4: Run `/laneconductor setup scaffold generate` against the resolved location (existing skill command, unmodified)
- [ ] Task 5: Register the new project (`INSERT INTO projects`) and its first `workers` row (`type: 'project'`, default)
- [ ] Task 6: If `repo_source` indicates a different machine than the manager worker's own, hand off to 1089-style provisioning instead of registering a local worker

## Phase 4: UI

**Problem**: No app-level entry point for creating a new project.
**Solution**: "New Project" flow, top-level (not inside an existing
project).

- [ ] Task 1: "New Project" entry point in the app shell
- [ ] Task 2: Collect project name, repo source (existing path or git URL), and scaffold answers (form vs. conversational — see index.md's open question)
- [ ] Task 3: Manager worker picker (if more than one available)
- [ ] Task 4: Dispatch on submit; show creation progress/result (reuses 1087's non-track dispatch transcript view once that exists)

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
