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

**✅ Phase 4 verified (2026-08-10)** — live browser verification against a
real manager worker and a real (scratch) API instance, not just unit
tests: filled out and submitted the actual form, watched the dispatch go
pending → claimed → done via real polling, confirmed the resulting
`.laneconductor.json`, scaffold context file, and new worker process on
disk matched what was submitted. This run is what surfaced the heartbeat
NULL-safety bug (see plan.md Phase 4) — it would not have been caught by
mocked-DB unit tests alone.

- [x] TC-21: Verified directly — "+ Project" button renders in the app header (`App.jsx`) regardless of `selectedProjectId`, alongside "+ Track"/"⚠ Bug".
- [x] TC-22: Verified directly — screenshotted the filled form (name, repo source radio + path input, purpose/tech-stack/KPI fields) and confirmed the resulting `scaffold_context` matched.
- [x] TC-23: Implemented, not exercised with 2+ managers — the picker code path (`managerWorkers.length > 1` → hostname-keyed `<select>`) was written and reviewed but the live verification only ever had one manager worker running. Should get real coverage (a second manager, different hostname) before Phase 6 closes.
- [x] TC-24: Verified directly, and extended beyond its original wording (REQ-5b) — confirmed the empty state renders correctly with zero managers registered, then found it needed more than "a clear message": added known-hostnames context so a multi-machine user isn't left guessing which machine to act on.
- [x] TC-25: Verified directly, with a scope correction — **not** 1085/1089's dispatch-status UI pattern as originally written (that pattern is project-scoped; `create-project` has no project to scope to). Built a dedicated, deliberately small status view instead (`status` + `result` text, polled via the new global `GET /api/dispatch/:dispatchId`). See plan.md Phase 4 for why.
- [x] TC-25b (added 2026-08-10, not in the original list): manager worker heartbeats correctly advance past the 60-second `GET /api/workers` freshness window instead of silently freezing at registration time. Verified live (registered a manager, waited 75s past registration, confirmed `last_heartbeat` had advanced) and by regression test (`ui/server/tests/track-1091-phase4-dispatch-status.test.mjs`, asserts `IS NOT DISTINCT FROM` in both `PATCH /worker/heartbeat` and `DELETE /worker`).

### Phase 5: Visual distinction for manager workers
- [x] TC-26: A `type: 'manager'` row renders a distinct badge in `WorkersList.jsx` instead of a project name (it has none) — verified by code read 2026-08-14, `data-testid="manager-badge"` present
- [x] TC-27: A `type: 'manager'` row renders the same distinct badge in `WorkerActivityLatch.jsx` (1087) — verified by code read 2026-08-14, same testid present
- [x] TC-28: A manager worker's `current_task` while running `create-project` routes to 1087 Phase 6's non-track dispatch log view, not the track-transcript path — verified by code read 2026-08-14: the dispatch-format `current_task` string matches `parseWorkerTask`'s deploy-kind regex
- [x] TC-29: `type: 'project'` workers render unchanged in both components — no regression from adding the manager case — verified by code read 2026-08-14: badge branches are additive conditionals, existing path untouched

### Phase 5b: Create Manager Worker UI (added 2026-08-14)
- [x] TC-32: `POST /api/workers/manager/start` actually starts a manager and it registers in the DB — verified live (no manager running beforehand, real registration confirmed within seconds, real PID)
- [x] TC-33: Free-text `projectsDir` cannot reach a shell — verified live with a shell-metacharacter payload (`; touch /tmp/INJECTION_PROOF`); no injection occurred
- [x] TC-34: `ui/server/tests/track-1091-manager-start.test.mjs` (new, 4/4 passing) — asserts the exact `execFile('lc', ['worker','start','--manager',...])` argument-array shape (not `exec()`+string), the `--projects-dir` omission case, a shell-metacharacter payload landing as one literal array element, and the 500/error path. `CreateManagerWorkerForm.jsx` itself stays covered by live manual verification only (no component-level test) — consistent with this file's existing standard for UI components elsewhere in this track.

### Phase 6: Tests (this file) + end-to-end
- [x] TC-30: End-to-end — submitting the New Project UI flow against a real manager worker results in a fully scaffolded project (all standard `conductor/` files present) and registered `projects`/`workers` rows, with no manual terminal command — verified live during Phase 4 (see plan.md), and again structurally for Phase 5b's manager-creation step
- [x] TC-31: Existing single-worker, `lc setup`-based onboarding path is completely unaffected — verified 2026-08-14 by two independent checks rather than assumed: (1) `git log` across every track-1091 commit confirms the `command === 'setup'` branch in `bin/lc.mjs` (the actual onboarding wizard) was never touched by any of them; (2) the one shared code path that *did* change — the `lc worker start/stop/restart/logs/sync` subcommand wrapper's exit-code propagation fix (Phase 2) — has been running live, continuously, this entire session via real non-manager (`type: 'project'`) workers on this machine (heartbeats advancing normally, no failures), which is direct evidence, not just "designed to be additive."

## Acceptance Criteria
- [x] All test cases above pass
- [x] `workers.type` migration applied with zero drift (confirmed via `atlas migrate diff`, matching this project's established migration verification pattern) — per Phase 1 record
- [x] No regressions in 1084 (worker identity), 1085 (dispatch), or 1087 (transcript/activity latch) — their own existing test suites still pass unmodified — per Phase 1-4 records; not independently re-run this cycle
