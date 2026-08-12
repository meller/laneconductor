# Plan: Worker Identity & Assignment (Track 1084)

## Phase 0: Stable Worker Identity

**Problem**: Worker identity today is `(project_id, hostname, pid)` — `pid`
is ephemeral, so a restart mints a new `workers` row and orphans anything
FK'd to it (pins, sessions). The local pidfile is also singular per project
directory, so a second worker process can't run for the same project on the
same host today.
**Solution**: Introduce a stable, user-assigned `worker_number` that
survives restarts, and move the DB uniqueness constraint onto it instead of
`pid`.

- [x] Task 1: Add `--worker-number <n>` flag to `lc worker start` (`bin/lc.mjs`), default `1`
- [x] Task 2: Migration — add `worker_number INTEGER NOT NULL DEFAULT 1` to `workers`, change constraint to `UNIQUE(project_id, hostname, worker_number)` (drop the `pid`-based one)
- [x] Task 3: `upsertWorker` (`conductor/laneconductor.sync.mjs`) sends `worker_number` in `POST /worker/register`; keep sending `pid` as informational/liveness data only
- [x] Task 4: Local pidfile becomes per-instance — `conductor/.sync-<worker_number>.pid` — so `lc worker start --worker-number 2` can run alongside `--worker-number 1` on the same machine
- [x] Task 5: `lc worker stop`/`lc worker status` accept `--worker-number` to target a specific instance (default `1` preserves today's single-command UX)

**✅ Phase 0 complete (2026-08-08).** Migration applied to local DB
(bypassing `atlas migrate apply` — the migration chain is separately
stuck on an unrelated pre-existing bug in `20260306103650`, see commit
`ad7d0ae`). 92 stale duplicate worker rows cleaned up as part of
applying the new constraint. All new tests pass
(`conductor/tests/track-1084-worker-identity.test.mjs`); full existing
suite run with no regressions (5 pre-existing failures confirmed
unrelated — a Vitest/node:test runner mismatch and a `.gitignore`
issue blocking git-lock commits, neither touching workers).

## Phase 1: Schema

**Problem**: No way to record which developer a worker belongs to, or which
developer a track is assigned to.
**Solution**: Migration adding `worker_pins` and `tracks.assignee_uid`.

- [x] Task 1: Migration — `worker_pins (project_id INTEGER REFERENCES projects(id), user_uid TEXT, worker_id INTEGER REFERENCES workers(id), created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (project_id, user_uid, worker_id))` — a developer can pin multiple workers per project
- [x] Task 2: Migration — `ALTER TABLE tracks ADD COLUMN assignee_uid TEXT`
- [x] Task 2b: Migration — `ALTER TABLE tracks ADD COLUMN created_by_uid TEXT` (discovered while implementing: Phase 2's `resolveAssignee` fallback chain needs a stable "who created this track" field, and none existed — `last_updated_by_uid` changes over time, it's not a creator marker)
- [x] Task 3: Apply via Atlas, verify against local + prod schema conventions used by prior worker-security migrations

**✅ Phase 1 complete (2026-08-08).** Implemented via `/laneconductor
lock 1084` → isolated worktree at `.worktrees/1084` → merged back into
main (`0bfd964`) → `/laneconductor unlock 1084`. Also hardened the
Phase 0 migration to handle both forms of the old
`workers_project_id_hostname_pid_key` index (plain vs. constraint-
backed) so `atlas migrate diff` can replay it against a fresh dev DB.
Verified: multi-pin per user works, duplicate pin correctly rejected
by the primary key.

## Design Simplification: worker_pins removed (2026-08-08)

**Change**: after Phase 1 shipped, we realized `worker_pins` (project_id,
user_uid, worker_id) duplicated what `workers.user_uid` already captures —
that column is set automatically at registration time (via API
key/Firebase auth, see [1033](../1033-worker-identity-and-remote-api-keys/index.md))
and already means "who this worker belongs to." A separate pin table only
earns its keep if pinning needs to mean something *other* than ownership —
e.g. routing work to a worker registered under a different developer's
identity. Discussing that case surfaced a real security question: routing
to another person's machine is machine access, and should require that
machine owner's explicit consent — not something to fall out of a query
change casually. That consent/authorization design is deliberately
**deferred**, not built here.

**Decision**: drop `worker_pins` entirely. "A developer's workers for a
project" is now just `SELECT * FROM workers WHERE project_id = $1 AND
user_uid = $2` (`resolvePinnedWorkers` in `ui/server/index.mjs`, kept its
name for now since callers didn't change). Default and only behavior:
**my workers only**. A developer with workers on multiple machines under
the same identity (e.g. laptop + cloud VM) already gets all of them.
Cross-user dispatch is out of scope until the consent mechanism above is
designed as its own track.

- `migrations/20260808133947_drop_worker_pins.sql` — drops the table
- `prisma/schema.sql` — `worker_pins` table definition removed
- `ui/server/index.mjs` — `GET/POST/DELETE /api/projects/:id/worker-pins`
  endpoints removed; `resolvePinnedWorkers` simplified to the query above
- `ui/src/components/WorkersList.jsx` — "Pin as mine" button, state, and
  fetch effect removed
- Phase 2 Task 4 and Phase 4 Task 2 below are superseded by this — struck
  through rather than rewritten, to keep the phase history honest

## Phase 2: Assignee Resolution

**Problem**: Need a single source of truth for "who owns this track" and
"which worker does that resolve to."
**Solution**: Shared resolver used by both claim logic and UI.

- [x] Task 1: `resolveAssignee(track, project)` — `track.assignee_uid` ?? `track.created_by_uid` ?? `project.owner_uid`
- [x] Task 2: `resolvePinnedWorkers(pool, project_id, user_uid)` — lookup ALL pins in `worker_pins` for this (project, user), returns a list (possibly empty) — ~~superseded 2026-08-08: now just queries `workers WHERE project_id = $1 AND user_uid = $2`, no separate table~~
- [x] Task 3: API endpoint `PATCH /api/projects/:id/tracks/:num/assignee` (dedicated endpoint, not routed through the lane/action collector-write path — assignee is a plain UI/DB field, not a filesystem-synced worker signal like Progress/Phase/Summary)
- ~~Task 4: API endpoints `POST /api/projects/:id/worker-pins`, `DELETE .../worker-pins/:worker_id`, `GET .../worker-pins`~~ — removed 2026-08-08, see Design Simplification above

**✅ Phase 2 complete (2026-08-08).** Verified: `PATCH .../assignee`
end-to-end via curl+psql (set and clear both work). Worker-pins
endpoints correctly reject unauthenticated requests in this local-api
deployment (`AUTH_ENABLED=false` means `resolveUid` always returns
null, matching worker_permissions' existing remote-api-only scope) —
their POST/GET/DELETE logic wasn't round-tripped through live auth
(inappropriate to flip test-mode auth on a real deployment for
verification) but mirrors the already-proven `worker_permissions`
pattern exactly, and the underlying `worker_pins` table behavior was
already verified directly in Phase 1.

## Phase 3: Claim Logic — Continuity-First Routing

**Problem**: Auto-launch claims any queued track regardless of who it's for;
with a developer having multiple pinned workers, need to route consistently
without serializing all their tracks onto one machine.
**Solution**: Gate claiming on assignee's candidate workers, preferring
whichever worker already has a session for this track (depends on
[1086](../1086-persistent-track-sessions/index.md)'s `track_sessions` table
— this specific task can't land until 1086's schema exists, even though the
rest of this phase can).

- [x] Task 1: In `autoLaunchLocalFs`, before claiming a track: resolve assignee, resolve candidate pinned workers (Phase 2 Task 2) — implemented server-side as a new `GET /api/projects/:id/claimable-tracks?worker_id=X` endpoint (reuses `resolveAssignee`/`resolvePinnedWorkers`), fetched once per auto-launch cycle rather than per track, since the worker has "zero DB knowledge" by design and can't run this resolution itself
- [ ] Task 2: Continuity check — deferred, as planned: needs [1086](../1086-persistent-track-sessions/index.md)'s `track_sessions` table, which doesn't exist yet. **→ Unblocked 2026-08-12 (1086 shipped, 100%); tracked as Phase 7 below rather than reopening this phase.**
- [x] Task 3: No prior session — any idle candidate worker may claim it (first-idle-wins) — this is the actual behavior right now, since there's no continuity check yet to prefer a specific one
- [x] Task 4: Apply the same gating to the API-mode claim path — there is only one claim path (`autoLaunchLocalFs`, shared by local-fs and API mode; the "claim-queue endpoint" comment nearby was stale/vestigial, no such endpoint is actually used for concurrency decisions), so this was gated once at the source
- [x] Task 5: Confirm unpinned-assignee fallback preserves current open-claim behavior exactly — verified via curl: a track whose assignee has no pins is claimable by any worker

**Discovered while implementing**: `projects.owner_uid` (needed by
`resolveAssignee`'s fallback chain) was declared in `prisma/schema.sql`
but had never actually been migrated onto the real DB — same class of
schema/reality drift as Phase 0's constraint issue. Applied directly;
`atlas migrate diff` confirmed the migration chain already accounted
for it, so no new migration file was needed, just catching the real DB
up.

**✅ Phase 3 complete for its current, achievable scope (2026-08-08)**
— everything except the continuity check, which is correctly blocked
on 1086. New test:
`conductor/tests/track-1084-worker-identity.test.mjs`'s Phase 3 suite
(extends `mock-collector.mjs` with `/claimable-tracks` +
`/_set-claimable`) — verified it actually catches a regression by
temporarily disabling the gating line and confirming the test fails,
then restoring. Manually verified open-claim and pin-gated scenarios
end-to-end via curl+psql against the real API+DB.

## Phase 4: UI

**Problem**: No way to see or change a track's assignee, or pin a worker as
"mine."
**Solution**: Additions to `TrackCard`/`TrackDetailPanel` and `WorkersList`.

- [x] Task 1: Assignee control on track detail panel — dropdown of project members, shows resolved worker + live status (falls back to a read-only span with an explanatory tooltip when there are no project members to choose from, i.e. no auth/no team in local-api mode)
- ~~Task 2: "Pin as mine" action on `WorkersList.jsx`~~ — removed 2026-08-08, see Design Simplification above; ownership is implicit via `workers.user_uid` now, no UI action needed
- [x] Task 3: Track card shows assignee's worker status badge (idle/busy/offline) alongside existing lane/status badges — `resolveAssigneeWorkerStatus(workers)` in `ui/server/index.mjs` collapses the assignee's own workers (busy if any is fresh+busy, idle if any is fresh, offline if all stale, null if none) into one badge on `GET /api/projects/:id/tracks`; rendered by `AssigneeWorkerStatusBadge` in `TrackCard.jsx`. Null (no badge shown) in local-fs/local-api deployments with no auth, same as Task 1 — verified live: `assignee_worker_status: null` across all 97 tracks in this deployment, board renders with no console errors.

## Phase 5: Tests

**Problem**: Claim-scoping is a coordination change — needs multi-worker
verification, not just unit tests.
**Solution**: Extend existing worker/queue test suites.

- [x] Task 1: Unit tests for `resolveAssignee`/`resolvePinnedWorkers`/`resolveAssigneeWorkerStatus` — `ui/server/tests/track-1084-assignee.test.mjs` (Vitest + supertest against the real `app`, mocked `pool`); 16 tests, added retroactively for Phase 2/3/4 logic that had only been curl/psql-verified until now — see "Discovered while implementing" note below
- [x] Task 2: Integration test with 2 mock workers (different `user_uid`) registered to one project — verify only the assignee's own worker claims an assigned track — same test file, `GET /api/projects/:id/claimable-tracks` suite
- [x] Task 3: Regression test — no-assignee track claimable by either mock worker (today's behavior preserved) — same suite, asserts track `003` (no assignee) is always claimable alongside the gated ones
- [x] Task 4: Reassignment test — moving assignee mid-`queue` changes which worker is eligible to claim — same test file, `PATCH .../assignee` suite: asserts the update SQL, then proves via two `claimable-tracks` calls that reassigning `001` from dev-a to dev-b flips which worker can claim it
- [x] Task 5: Restart test — covered by the pre-existing `ON CONFLICT preserves visibility` test in `ui/server/tests/track-1033-worker-auth.test.mjs`, which exercises the same `ON CONFLICT(project_id, hostname, worker_number) DO UPDATE ... RETURNING id` path that makes a restart reuse `workers.id` rather than insert a new row — no new test needed, the conflict target itself is what Phase 0 already changed from `pid` to `worker_number`
- [x] Task 6: Two-instance test — already covered by Phase 0's `two workers (default + --worker-number 2) can run concurrently without pidfile collision` in `conductor/tests/track-1084-worker-identity.test.mjs`

**Discovered while implementing**: Phase 2 and Phase 3 shipped without unit/integration
coverage for `resolveAssignee`/`resolvePinnedWorkers`/the `claimable-tracks` endpoint —
plan.md's Phase 2/3 completion notes say they were verified via curl+psql only, with
tests deferred to this phase. Adding coverage now doesn't follow strict red-green TDD
(the implementation predates the tests by two phases) — noted honestly rather than
rewriting history; the `mock-collector`-based test in
`conductor/tests/track-1084-worker-identity.test.mjs` covers the sync-worker's
*consumption* of `claimable-tracks`, not the endpoint's own SQL/resolution logic, which
is what Task 1/2/3 above close.

## Phase 6 (reopened 2026-08-12): Worker lifecycle UI gaps

**Problem**: Found live while browser-testing tracks 1089/1091/1096 —
`WorkersList.jsx`'s worker start/stop controls were built around a "zero or
one worker per project" mental model, even though Phase 0 of this track
already made multiple workers per project a first-class, fully-supported
case (`--worker-number`, per-instance pidfiles, stable identity). Three
specific gaps, all in the same file:

- [ ] Task 1: **No way to add a worker once a project already has one.**
  `WorkersList.jsx`'s only "start a worker" affordance (`Start Sync Worker`)
  is gated behind `!hasWorkers` (grid layout, ~line 158) — it disappears
  the moment a project has even one worker running. There is currently no
  UI path to start worker #2, #3, etc. for a project, even though the
  backend has fully supported this since Phase 0. (Track 1089's `+ New
  Worker` — SSH provisioning to a *different* machine — is a different
  concern and was hidden 2026-08-12 since its backend is a stub; this task
  is about adding another *local* worker to a project that already has
  one, which needs its own affordance regardless of 1089's fate.)
- [ ] Task 2: **No per-worker stop button.** Only a single global "Stop All
  Workers" button exists per project (grid layout, ~line 288); there's no
  way to stop just worker #2 while leaving #1 running. `handleWorkerAction`
  only knows `start`/`stop` at the project level (`POST
  /api/projects/:id/worker/:action`, which shells out to `make
  lc-start`/`lc-stop` — both project-wide, not worker-number-aware).
  Needs either a new worker-number-aware backend action, or a
  `lc worker stop --worker-number <n>` invocation per button.
- [ ] Task 3: **"Stop All Workers" scope, verified safe but worth
  confirming explicitly.** Raised as a concern ("shouldn't stop the
  manager") — traced live: the button is project-scoped
  (`POST /api/projects/:id/worker/:action` → `make lc-stop` in that
  project's own `repo_path`), and a manager worker (track 1091) lives in
  its own separate directory/config entirely, so it's structurally
  unreachable from this button today. Confirmed, not a bug — but also
  found the button silently no-ops in the global "All Projects" Workers
  view specifically: `handleWorkerAction` does `if (!projectId) return;`,
  and that view has no single project in context, so the button does
  nothing there with no error shown. Worth either disabling/hiding the
  button in that view, or making it a genuine no-op-with-explanation
  rather than a silent one.

- [ ] Task 4 (found live while testing Task 1): **`GET /api/projects/:id/workers` folds every manager worker into every project's view**, via a `WHERE (w.project_id = $1 OR w.type = 'manager')` clause added for track 1096's own reasons. Side effect confirmed live: a project (macrodash) with zero of its own workers still has `hasWorkers === true` because a manager running in a completely unrelated directory counts — so the empty-state `Start Sync Worker` button never renders for *any* project as long as any manager is registered anywhere, even though that project genuinely has no worker of its own. A manager showing up in a *global* workers view (Task 1091's own concern) is reasonable; folding it into every individual *project's* view is not — those are different questions ("what workers exist" vs. "what workers does this project have").

Not yet planned in detail — needs its own design pass (in particular Task
2's backend shape and Task 4's fix, which likely means a project-scoped
"has this project's own worker" check that's separate from any global
"is a manager visible" check) before implementation, per this project's
own brainstorming-before-code convention.

### Phase 6 implementation (2026-08-12)

- [x] Task 1: `Start Sync Worker` reappears — gate changed from `hasWorkers`
      to `hasOwnWorkers` (see Task 4).
- [x] Task 2: Per-worker **Stop** button on every worker card, plus
      `POST /api/workers/:id/stop` (requireAuth). Uses the existing
      `lc worker stop --worker-number N` / `--manager`, which already
      supported this via per-instance pidfiles — only the endpoint and
      button were missing. Verified live: stopped worker #1 while the
      manager kept running. 3 tests.
- [x] Task 3: `Stop All Workers` / `Start Sync Worker` are now hidden
      unless a project is selected. Both shell out to `make lc-stop` /
      `make lc-start` in a project directory, so in the All Projects view
      they silently did nothing (`handleWorkerAction` returns early on
      `!projectId`) with no feedback. Also confirmed the original concern:
      Stop All *cannot* reach a manager — it runs in the project's own
      directory and a manager lives elsewhere — and the button now says so
      in its tooltip rather than leaving it to be inferred.
- [x] Task 4: `hasOwnWorkers` separates "does this project have a worker of
      its own" from "what workers are visible here". A manager is
      deliberately included in a project's worker list (the New Project and
      provisioning flows need to find it) but belongs to no project, so it
      was making every project look staffed and suppressing the empty state
      everywhere.

- [ ] **Weakness found while verifying, not fixed**: the stop endpoint
      trusts `lc worker stop`'s exit code, and that command exits 0 with a
      warning when there's no pidfile ("⚠️ No heartbeat running"). So a
      worker started outside `lc` (or one whose pidfile was lost) reports
      `{ok: true}` and a cheerful "stopped" while the process keeps
      running. `workers.pid` is right there in the row the endpoint
      already fetches — it should verify the process is actually gone
      (`process.kill(pid, 0)`) and report honestly if it isn't.

## Phase 7: Continuity-first routing (unblocked 2026-08-12)

**Problem**: `claimable-tracks` currently answers "may this worker claim
this track?" with the assignee gate alone. Among an assignee's candidate
workers it is first-idle-wins, so a track can be claimed by a worker that
has never seen it while the worker holding its live Claude session sits
idle. That worker then cold-starts and rebuilds the entire context —
`product.md`, `tech-stack.md`, `spec.md`, `plan.md`, `conversation.md`, the
lot — which is precisely the cost `FRESH_SESSION` exists to avoid.

The endpoint says so itself (`ui/server/index.mjs:3785`):

> *"(Continuity-first routing via track_sessions — track 1086 — is a
> follow-up once that table exists; this is the assignee gate alone.)"*

**That table now exists** — 1086 is `done`, 100%. The stated precondition is
met, so this is no longer deferred work, it is just unimplemented work.

**Solution**: implement REQ-3 step 3 — if `track_sessions` holds a row for
`(track_number, worker_id)` and that worker is among the candidates, only
that worker may claim the track. Fall back to today's first-idle-wins when
there is no session row.

- [ ] Task 1: In `claimable-tracks` (`ui/server/index.mjs:3770`), after the
      assignee gate, look up `track_sessions` for the queued track numbers.
      Batch it — one query for the whole candidate set, not per track; the
      endpoint is already called once per auto-launch cycle and must not
      become N+1.
- [ ] Task 2: If a session row exists for this track, return it as claimable
      **only** to that `worker_id`. No session row → unchanged behaviour.
- [ ] Task 3: Liveness escape hatch. A session pinned to a worker that is
      dead or long gone must not strand the track forever — if the holder
      has aged out of the 60s heartbeat-freshness window used by
      `GET /api/workers`, fall back to first-idle-wins. **Decide explicitly
      whether to also delete the stale `track_sessions` row** (there is
      already a `DELETE /track/:num/session`), or leave it so the original
      worker reclaims continuity if it comes back. Leaving it is probably
      right; make it a decision, not an accident.
- [ ] Task 4: Tests — extend `conductor/tests/track-1084-worker-identity.test.mjs`'s
      Phase 3 suite (its `mock-collector.mjs` already fakes
      `/claimable-tracks` + `/_set-claimable`). Required cases:
      - session-holder gets it, non-holder is refused **(assert the refusal,
        not just the grant)**
      - no session row → both candidates eligible, unchanged
      - dead session-holder → track becomes claimable again (Task 3)
- [ ] Task 5: Prove the payoff end to end rather than asserting it: run the
      same track twice across two registered workers and confirm the second
      run receives `FRESH_SESSION: false`. A green routing test that still
      cold-starts every time would be a false pass — the whole point of this
      phase is the session reuse, not the routing decision on its own.

**Sequencing**: [1109](../1109-worker-claim-allowlist/index.md) adds a claim
allowlist to this same function. Two independent claim predicates landing in
`claimable-tracks` at once will conflict — land one, then rebase the other.
The intersection semantics also need stating: an explicit `--only-tracks`
allowlist should almost certainly **override** continuity (the operator asked
for this track on this worker), but that ordering must be written down and
tested, not left to whichever `if` happens to come first.
