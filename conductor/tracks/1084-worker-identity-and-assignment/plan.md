# Plan: Worker Identity & Assignment (Track 1084)

## Phase 1: Schema

**Problem**: No way to record which developer a worker belongs to, or which
developer a track is assigned to.
**Solution**: Migration adding `worker_pins` and `tracks.assignee_uid`.

- [ ] Task 1: Migration — `worker_pins (project_id INTEGER REFERENCES projects(id), user_uid TEXT, worker_id INTEGER REFERENCES workers(id), created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (project_id, user_uid, worker_id))` — a developer can pin multiple workers per project
- [ ] Task 2: Migration — `ALTER TABLE tracks ADD COLUMN assignee_uid TEXT`
- [ ] Task 3: Apply via Atlas, verify against local + prod schema conventions used by prior worker-security migrations

## Phase 2: Assignee Resolution

**Problem**: Need a single source of truth for "who owns this track" and
"which worker does that resolve to."
**Solution**: Shared resolver used by both claim logic and UI.

- [ ] Task 1: `resolveAssignee(track, project)` — `track.assignee_uid` ?? `track.created_by` ?? `project.owner_uid`
- [ ] Task 2: `resolvePinnedWorkers(project_id, user_uid)` — lookup ALL pins in `worker_pins` for this (project, user), returns a list (possibly empty)
- [ ] Task 3: API endpoint `PATCH /api/tracks/:id` (or extend existing track update endpoint) to accept `assignee_uid`
- [ ] Task 4: API endpoints `POST /api/projects/:id/worker-pins` (add a pin), `DELETE /api/projects/:id/worker-pins/:worker_id` (remove a pin), `GET /api/projects/:id/worker-pins` (list current user's + team's pins per visibility rules)

## Phase 3: Claim Logic — Continuity-First Routing

**Problem**: Auto-launch claims any queued track regardless of who it's for;
with a developer having multiple pinned workers, need to route consistently
without serializing all their tracks onto one machine.
**Solution**: Gate claiming on assignee's candidate workers, preferring
whichever worker already has a session for this track (depends on
[1086](../1086-persistent-track-sessions/index.md)'s `track_sessions` table
— this specific task can't land until 1086's schema exists, even though the
rest of this phase can).

- [ ] Task 1: In `autoLaunchLocalFs`, before claiming a track: resolve assignee, resolve candidate pinned workers (Phase 2 Task 2)
- [ ] Task 2: Continuity check — if `track_sessions` has a row for this track where `worker_id` is one of the candidates, only that worker may claim it
- [ ] Task 3: No prior session — any idle candidate worker may claim it (first-idle-wins)
- [ ] Task 4: Apply the same gating to the API-mode claim path (`conductor/laneconductor.sync.mjs` claim-queue usage)
- [ ] Task 5: Confirm unpinned-assignee fallback preserves current open-claim behavior exactly (no regression for existing single-worker projects)

## Phase 4: UI

**Problem**: No way to see or change a track's assignee, or pin a worker as
"mine."
**Solution**: Additions to `TrackCard`/`TrackDetailPanel` and `WorkersList`.

- [ ] Task 1: Assignee control on track detail panel — dropdown of project members, shows resolved worker + live status
- [ ] Task 2: "Pin as mine" action on `WorkersList.jsx`, scoped to current project, shows current pin state
- [ ] Task 3: Track card shows assignee's worker status badge (idle/busy/offline) alongside existing lane/status badges

## Phase 5: Tests

**Problem**: Claim-scoping is a coordination change — needs multi-worker
verification, not just unit tests.
**Solution**: Extend existing worker/queue test suites.

- [ ] Task 1: Unit tests for `resolveAssignee`/`resolvePinnedWorker`
- [ ] Task 2: Integration test with 2 mock workers registered to one project — verify only the pinned worker claims an assigned track
- [ ] Task 3: Regression test — unpinned/no-assignee track claimable by either mock worker (today's behavior preserved)
- [ ] Task 4: Reassignment test — moving assignee mid-`queue` changes which worker is eligible to claim
