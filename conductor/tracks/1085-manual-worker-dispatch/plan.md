# Plan: Manual Worker Dispatch (Track 1085)

## Phase 1: Schema

**Problem**: No way to address a command at a specific worker.
**Solution**: `worker_dispatch` table, separate from the general track queue.

- [x] Task 1: Migration — `worker_dispatch` table, `track_number` nullable, generic `payload JSONB` column (see spec REQ-1)
- [x] Task 2: Index on `(worker_id, status)` for the polling query

**✅ Phase 1 complete (2026-08-09).** `migrations/20260809090728_add_worker_dispatch.sql`,
applied directly to the real `laneconductor` DB (same `atlas migrate apply`-chain
workaround as 1084's migrations — `atlas migrate diff` against `laneconductor_dev`
confirms zero drift afterward). Verified via `\d worker_dispatch`: table, PK,
`idx_worker_dispatch_worker_status`, and the `workers(id)` FK all present as specified.

## Phase 2: Worker Loop

**Problem**: Workers only ever act on the general queue (and only in
`sync+poll` mode); there's no per-worker inbox check.
**Solution**: Add an inbox check to the existing sync-tick interval,
unconditional on worker mode.

- [x] Task 1: `checkDispatchInbox()` — query pending entries for this worker, oldest first
- [x] Task 2: On a lane-action match, mark `claimed`, run via existing `spawnCli` (reuse context injection, logging, timeout/kill handling as-is)
- [x] Task 3: On a `deploy` match, mark `claimed`, run via the new shared deploy-runner (Phase 5 — pulled forward, see below; the "(Phase 6)" in the original task text was a stale reference, Phase 5 is the deploy runner phase)
- [x] Task 4: On process exit, mark `done`/`failed` — via `reconcileActiveDispatch()`, a separate poller rather than an exit callback (see note below)
- [x] Task 5: Wire the inbox check into the sync tick unconditionally (runs in both `sync-only` and `sync+poll`)

**✅ Phase 2 complete (2026-08-09).** `checkDispatchInbox()`/`reconcileActiveDispatch()` in
`conductor/laneconductor.sync.mjs`, wired via two `setInterval`s (10s inbox check, 5s
reconcile), neither gated by `syncOnly`. No-ops in local-fs mode (`myWorkerId`/collector
URL are both null there — dispatch inherently needs the API to store "which worker").

**Design choice for Task 4**: `spawnCli` is fire-and-forget (autoLaunchLocalFs doesn't
await it either) and its `proc.on('exit', ...)` handler is already the most complex,
heavily-relied-upon part of this file — adding a second completion path into it risked
regressing the primary auto-launch flow for a lower-risk gain. Instead
`reconcileActiveDispatch()` polls the same `**Lane Status**` field spawnCli's own exit
handler already writes to `index.md`. This surfaced a real subtlety:
`resolveTransition()` doesn't always write a clean `success`/`failure` literal — a lane
with a configured `on_success`/`on_failure` transition can land on `queue` either because
the action succeeded and moved to the next lane, or because it failed but hasn't hit
`max_retries` yet (same value, genuinely indistinguishable from `index.md` alone — that
ambiguity is inherent to the existing lane-transition system). Only literal `failure` is
reported as `failed`; everything else that leaves `running` is reported `done` (with a
`result` note when the outcome itself is ambiguous). Verified end-to-end via
`conductor/tests/track-1085-dispatch-worker.test.mjs` (3 tests: sync-only isolation from
the general queue, sync+poll also honoring dispatch, deploy dispatch + log file).

## Phase 3: API

**Problem**: Nothing can create a dispatch entry yet.
**Solution**: New endpoints on the collector API — one track-scoped (lane
actions), one project-scoped (deploy).

- [x] Task 1: `POST /api/tracks/:id/dispatch { worker_id, action }` — validates action against track's current lane, inserts `pending` row
- [ ] Task 2: `GET /api/tracks/:id/dispatch` — list dispatch history for the track (for the UI's activity view) — deferred to Phase 4, alongside the UI that consumes it
- [x] Task 3: `POST /api/projects/:id/dispatch { worker_id, action: 'deploy', payload: { environment } }` — validates `payload.environment` present, inserts `pending` row with `track_number: null` (validating the environment actually exists in that specific worker's `deploy.json` isn't possible server-side — the API doesn't have filesystem access to a worker's checkout; the worker-side `runDeploy` call already fails clearly if the environment isn't configured, satisfying the "fails clearly, not silently" acceptance criterion, just later in the pipeline than originally envisioned)

**✅ Phase 3 complete for its worker-facing + enqueue scope (2026-08-09),
pulled forward from its own slot since Phase 2's `checkDispatchInbox()`
can't function without somewhere to read/claim/report against.** Also
added (not originally itemized, but required for the worker loop): `GET
/worker/:id/dispatch` (pending entries, oldest first) and `PATCH
/worker-dispatch/:id` (status transitions + optional `result` message —
added a `result TEXT` column to `worker_dispatch`, migration
`20260809091937_add_worker_dispatch_result.sql`, mirroring
`tracks.lane_action_result`). All 6 endpoints covered by
`ui/server/tests/track-1085-dispatch.test.mjs` (13 tests, Vitest+supertest
against the real `app` with a mocked `pool`, same pattern as 1084's test
suite).

## Phase 4: UI

**Problem**: No way to trigger dispatch from the app.
**Solution**: New controls on the track detail panel (lane actions) and a
project-level surface (deploy).

- [x] Task 1: `Run on worker: [worker ▾] [Run <lane> now]` control on `TrackDetailPanel.jsx` — worker dropdown defaults to one of the resolved assignee's own workers (`workers.user_uid`, 1084) or the first idle worker; "action" isn't actually a separate dropdown — the API only ever accepts `action === track.lane_status` (see Phase 3's validation), so there is exactly one valid action per track at any time, shown as the button's own label
- [x] Task 2: Disable/hide when resolved worker is offline (`last_heartbeat` >60s stale) or no valid action exists (track's lane isn't one of plan/implement/review/quality-gate — the control doesn't render at all for backlog/done)
- [x] Task 3: Dispatch history — last 3 entries (action, status, time, result) inline under the control, polled every 4s
- [x] Task 4: `Deploy: [env ▾] on [worker ▾] [Deploy Now]` control on `WorkersList.jsx`'s grid layout, gated on `projectId` set (project-scoped, hidden in "All Projects" view) and `deploy-environments` returning at least one — doesn't need the `IS_LOCAL_HOST` gate the Start/Stop Sync Worker buttons need, since it runs through `worker_dispatch` and executes on the *worker's* machine, not via `execAsync` on the API server
- [x] Task 5: Deploy dispatch history — same inline pattern as Task 3, project-scoped (`track_number IS NULL`)

**✅ Phase 4 complete (2026-08-09).** Verified live end-to-end against the real
`laneconductor` DB/API — not just mocked: registered a real `--sync-only`
worker for this project, clicked "Deploy Now" for real in the browser (user
explicitly authorized testing against the real prod deploy since no one
else is using it), and it correctly enqueued, got claimed, and ran the
actual `bash scripts/deploy.sh prod`.

**Discovered while verifying (real bug, not a mock artifact)**: the first
live attempt *hung forever*. `scripts/deploy.sh` has an interactive
`read -p "Continue? (y/N)"` confirmation gate; `deploy-runner.mjs` spawned
it with default stdio (`'pipe'` for stdin, connected to nothing), so `read`
blocked indefinitely with no one able to answer — silently consuming a
worker slot forever, exactly the kind of failure the "fails clearly, not
silently" acceptance criterion (spec.md) exists to prevent. Fixed two ways:
1. `scripts/deploy.sh`'s confirmation now also checks `[ -t 0 ]` (only
   prompts when actually attached to a terminal) — the idiomatic fix, and
   it turned out this same gap silently broke `lc deploy`'s own CLI-path
   confirmation too, from when Phase 5 switched off `stdio: 'inherit'` to
   capture output for logging. Not caught by the CLI smoke test earlier in
   Phase 5, since that test's `deploy.json` had no confirmation step.
2. `deploy-runner.mjs` now spawns with `stdio: [echo ? 'inherit' : 'ignore', 'pipe', 'pipe']`
   — `'inherit'` preserves the CLI's ability to answer prompts interactively;
   `'ignore'` (the worker's dispatch path) closes stdin so *any* script that
   doesn't adopt the `[ -t 0 ]` pattern fails fast on EOF instead of hanging
   — defense in depth, not dependent on every project's deploy script being
   written correctly. New regression test in `deploy-runner.test.mjs`
   (a `read`-based command against closed stdin, asserting it resolves in
   under 4s rather than hanging).

A second live dispatch after the fix completed the full pipeline correctly —
version bump, npm install, build — and failed only on a genuine
pre-existing infrastructure issue (Neon Postgres credential rejection
during migration), unrelated to dispatch. Confirms the mechanism itself
works correctly under real conditions, not just mocks. (The version-bump
side effects from both attempts were reverted — no real release was
intended.)

## Phase 5: Deploy Runner (shared)

**Problem**: Deploy execution logic (`bin/lc.mjs`'s `deploy` command) only
runs from a human's terminal; the worker needs to run the same logic itself.
**Solution**: Extract the existing `lc deploy <env>` logic into a shared
function both the CLI and the worker call, instead of duplicating it.

- [x] Task 1: Extract `runDeploy(projectRoot, env)` from `bin/lc.mjs`'s inline `deploy` command handler — reads `conductor/deploy.json`, runs configured command(s) for `env`, logs to `conductor/logs/deploy-<env>-<timestamp>.log`
- [x] Task 2: `bin/lc.mjs`'s `deploy` command calls the shared function (no behavior change for the existing CLI path)
- [x] Task 3: `conductor/laneconductor.sync.mjs`'s dispatch handler calls the same shared function

**✅ Phase 5 complete (2026-08-09), pulled forward — Phase 2 Task 3
(deploy dispatch execution) can't work without it.** New file
`conductor/deploy-runner.mjs`. TDD'd first (6 tests in
`conductor/tests/deploy-runner.test.mjs`, watched RED against the
not-yet-created module, then GREEN). **Also a real bug fix**: the original
CLI `deploy` command computed a `logFile` path and printed it in error
messages, but never actually wrote output to it (`stdio: 'inherit'` only
streams to the terminal) — `runDeploy` genuinely writes to the log file
now, verified via a live `lc deploy` smoke test in a temp project
(`.test-tmp-lc-deploy-smoke`, output streamed to terminal exactly as
before *and* captured to the log file). `bin/lc.mjs`'s `deploy` command
is now a ~15-line wrapper around `runDeploy(projectRoot, env, { echo: true })`.

## Phase 6: Tests

- [x] Task 1: Dispatch to a `sync-only` worker runs the action, general queue untouched — `conductor/tests/track-1085-dispatch-worker.test.mjs`
- [x] Task 2: Dispatch to a `sync+poll` worker also works — same file
- [x] Task 3: Dispatching an action invalid for the current lane is rejected — `ui/server/tests/track-1085-dispatch.test.mjs`
- [ ] Task 4: Two workers, dispatch targeted at worker A never runs on worker B — not yet covered; the API-level tests prove the `worker_id` column scopes `GET /worker/:id/dispatch` correctly, but no test spins up two real worker processes and confirms only the targeted one acts
- [x] Task 5: Deploy dispatch runs the correct `deploy.json` command for the chosen environment and produces the same log file the existing `lc deploy` CLI path produces — `conductor/tests/track-1085-dispatch-worker.test.mjs` + `deploy-runner.test.mjs`
- [x] Task 6: Deploy dispatch to an unconfigured environment fails clearly — `runDeploy`'s error path (`deploy-runner.test.mjs`); enforced at the worker, not rejected at enqueue time (API can't see a specific worker's `deploy.json` — see Phase 3 note)
