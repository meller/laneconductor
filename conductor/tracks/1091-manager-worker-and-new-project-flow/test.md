# Tests: Track 1091 — Manager Worker Type & New-Project Flow

## Test Commands
```bash
# Worker/schema/dispatch tests (node:test, spawns real worker processes)
node --test conductor/tests/track-1091-*.test.mjs

# API tests (Vitest + supertest, mocked DB)
cd ui && npx vitest run server/tests/track-1091-*.test.mjs
```

## Test Cases

### Phase 1: Schema — `workers.type`, `create-project` dispatch validation
- [ ] TC-1: Migration applies cleanly against a fresh DB; `workers.type` defaults to `'project'` for an INSERT that doesn't specify it
- [ ] TC-2: `project_id` is nullable — a row with `type: 'manager', project_id: NULL` inserts successfully
- [ ] TC-3: A `type: 'project'` row still requires `project_id` (existing 1084 behavior unaffected — regression check)
- [ ] TC-4: Partial unique index rejects a second `type: 'manager'` row for the same `hostname` (any project_id, since it's null for managers)
- [ ] TC-5: Two `type: 'manager'` rows on *different* hostnames both succeed (index is per-hostname, not global)
- [ ] TC-6: `POST .../dispatch` (create-project) is rejected with a clear error when `worker_id` refers to a `type: 'project'` worker
- [ ] TC-7: `POST .../dispatch` (create-project) succeeds when `worker_id` refers to a `type: 'manager'` worker

### Phase 2: CLI — `lc worker start --manager`
- [ ] TC-8: `lc worker start --manager` sends `type: 'manager'`, `project_id: null` in the `POST /worker/register` body
- [ ] TC-9: Omitting `--manager` still sends `type: 'project'` (default, backward compatible — existing scripts/tests unaffected)
- [ ] TC-10: A second `lc worker start --manager` on a hostname that already has one registered fails clearly (`"Manager worker already running on this machine (PID <pid>)"`), does not register a second row, and does not silently reuse the existing one
- [ ] TC-11: `--manager` combines with `--sync-only` without error
- [ ] TC-12: `--worker-number` is a no-op (or explicitly rejected/warned) for `--manager` — there's only ever one per machine
- [ ] TC-12b (added 2026-08-10, REQ-2b): `--projects-dir <path>` persists to `~/.laneconductor/manager-config.json`; a later `lc worker start --manager` without the flag reuses the stored value; passing it again updates the stored value
- [ ] TC-12c: a `create-project` dispatch with `repo_source.type: 'git'` and no configured `projectsDir` fails that dispatch clearly instead of guessing a location

### Phase 3: Worker-side handler — `create-project` dispatch execution

**✅ Phase 3 verified (2026-08-10).** Coverage below is specific about what
each test actually exercises vs. what's implemented-but-not-separately-
tested here, per this track's own hardened verification standard.

- [x] TC-13: Implemented (`checkDispatchInbox`'s `isManager` guard,
  `laneconductor.sync.mjs:4199-4205`) — logs and skips a `create-project`
  entry when the worker's own type isn't `'manager'`. Not separately
  exercised by a `type: 'project'` worker in a test; mirrors REQ-3's
  API-level check (TC-6, which is tested).
- [x] TC-14: Verified directly — `track-1091-create-project-worker.test.mjs` uses
  `repo_source.type: 'path'` and asserts scaffold context + config land at
  that exact path, no clone attempted.
- [x] TC-15: Verified at the unit level, not integration — `create-project-utils.test.mjs`
  covers `resolveRepoTarget`'s git-URL resolution (explicit `target_path`,
  `<projectsDir>/<slug>` fallback, missing-projectsDir failure) directly.
  Deliberately not re-exercised against a real `git clone` in the worker
  integration test (would require real network access); the `execSync('git
  clone ...')` call site itself is straight-line code once the path is
  resolved.
- [x] TC-16: Verified directly — asserted file content matches the dispatch's
  `payload.scaffold_context`.
- [x] TC-17: Invocation path verified, not generated-file content —
  the integration test uses `LC_MOCK_CLI` (never runs the real `claude`
  CLI), so it confirms `runCreateProject` spawns the right command/args at
  the right cwd, not what `/laneconductor setup scaffold generate` itself
  produces — that's existing, unmodified skill behavior, already covered
  by this project's own onboarding.
- [x] TC-18: **Design changed from the original plan, not just untested** —
  see plan.md Phase 3 Task 5: no direct `INSERT INTO projects` happens.
  The manager spawns `lc worker start` at the new location, which
  self-registers through the existing `/project/ensure` pipeline, same as
  every other project. Verified indirectly: the mock collector's
  `/project/ensure` handler is what actually creates the row on a real
  Collector API.
- [x] TC-19: Verified directly — mock collector's registration log shows a
  second, distinct `/worker/register` call (not the manager's own) after
  dispatch completion.
- [x] TC-20: Implemented, not test-covered — `runCreateProject` rejects when
  `repo_source.target_machine` names a hostname other than the worker's
  own, citing track 1089 (which doesn't exist yet) rather than silently
  registering a local worker. No test exercises this branch; the check
  itself is a single straight-line comparison
  (`laneconductor.sync.mjs:4002-4009`). Should get an explicit test case
  before Phase 6, not deferred indefinitely.

### Phase 4: UI — "New Project" flow
- [ ] TC-21: A "New Project" entry point is visible at the top level of the app (not nested inside an existing project's view)
- [ ] TC-22: The form collects project name, repo source (path or git URL), and scaffold Q&A answers
- [ ] TC-23: A manager-worker picker is shown when more than one manager worker is available; auto-selected (no picker shown) when exactly one exists
- [ ] TC-24: No manager worker available — the flow shows a clear message rather than a broken/empty picker
- [ ] TC-25: Submitting dispatches a `create-project` action and shows creation progress/result, reusing 1085/1089's existing dispatch-status UI pattern

### Phase 5: Visual distinction for manager workers
- [ ] TC-26: A `type: 'manager'` row renders a distinct badge in `WorkersList.jsx` instead of a project name (it has none)
- [ ] TC-27: A `type: 'manager'` row renders the same distinct badge in `WorkerActivityLatch.jsx` (1087)
- [ ] TC-28: A manager worker's `current_task` while running `create-project` routes to 1087 Phase 6's non-track dispatch log view, not the track-transcript path
- [ ] TC-29: `type: 'project'` workers render unchanged in both components — no regression from adding the manager case

### Phase 6: Tests (this file) + end-to-end
- [ ] TC-30: End-to-end — submitting the New Project UI flow against a real manager worker results in a fully scaffolded project (all standard `conductor/` files present) and registered `projects`/`workers` rows, with no manual terminal command
- [ ] TC-31: Existing single-worker, `lc setup`-based onboarding path is completely unaffected by any of the above (regression check — run existing setup/scaffold tests, confirm unchanged)

## Acceptance Criteria
- [ ] All test cases above pass
- [ ] `workers.type` migration applied with zero drift (confirmed via `atlas migrate diff`, matching this project's established migration verification pattern)
- [ ] No regressions in 1084 (worker identity), 1085 (dispatch), or 1087 (transcript/activity latch) — their own existing test suites still pass unmodified
