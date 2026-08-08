# Spec: Worker Identity & Assignment (Track 1084)

## Problem Statement

Remote-mode track claiming is a race: every worker registered to a project
polls the same queue and claims whatever's unclaimed first. With multiple
developers each running their own worker, there's no way to route a track to
a specific person's machine.

## Requirements

**REQ-0: Stable worker identity (prerequisite for pinning to mean anything)**
- Today a worker's identity in the DB is `(project_id, hostname, pid)`
  (`conductor/workers_schema.sql`, `UNIQUE(project_id, hostname, pid)`) and
  the local pidfile is singular per project directory (`conductor/.sync.pid`
  in `bin/lc.mjs`). Two problems this causes for REQ-1/REQ-3:
  1. `pid` is ephemeral — every worker restart gets a new OS pid, which
     under the current uniqueness constraint mints a *new* `workers` row.
     Since `worker_pins.worker_id` and `track_sessions.worker_id` both FK to
     `workers.id`, a restart would silently orphan every pin and session
     tied to that worker.
  2. The singular pidfile means a second `lc worker start` on the same
     machine for the same project can't run today — no way to have two
     concurrent worker processes for one project on one host.
- Add a `--worker-number <n>` flag to `lc worker start` (default `1`,
  preserving today's single-worker-per-host behavior with zero config for
  existing setups). Registration (`POST /worker/register`,
  `conductor/laneconductor.sync.mjs`'s `upsertWorker`) sends
  `worker_number` alongside `hostname`; `pid` becomes purely informational
  (liveness/current-process tracking), not part of the identity key.
- Change the DB uniqueness constraint to
  `UNIQUE(project_id, hostname, worker_number)` — a worker's identity (and
  therefore its `workers.id`, and everything pinned/sessioned against it)
  survives process restarts.
- Local pidfile becomes per-instance: `conductor/.sync-<worker_number>.pid`
  instead of the single `conductor/.sync.pid`, so multiple worker processes
  can run concurrently for the same project on the same machine.

**REQ-1: Worker pinning (many per developer)**
- New table `worker_pins (project_id, user_uid, worker_id, created_at, PRIMARY KEY (project_id, user_uid, worker_id))`.
- A developer can pin *multiple* workers to the same project (e.g. a laptop
  and a cloud VM), not just one — this is what makes parallel plan/implement
  across different tracks possible for a single developer.
- Settable from the Workers list UI ("Pin as mine" action per worker, scoped
  to the current project; a developer can have several active pins at once).

**REQ-2: Track assignment**
- New column `tracks.assignee_uid` (nullable) — identifies the *developer*
  responsible for the track, not a specific machine.
- If unset, the resolved assignee is the track's creator; if the creator is
  unknown, fall back to the project owner.
- Reassignable from the track card/detail panel to any project member.
- No separate "which worker" field — which of the assignee's pinned workers
  actually runs the track is resolved dynamically per REQ-3, using session
  continuity from [1086](../1086-persistent-track-sessions/index.md).

**REQ-3: Claim-scoping with continuity-first routing**
- In `autoLaunchLocalFs` (and the equivalent API-mode claim path) in
  `conductor/laneconductor.sync.mjs`, before a worker claims a `queue`-status
  track:
  1. Resolve the track's assignee (REQ-2).
  2. Look up all `worker_pins` for that (project_id, assignee_uid) — the
     assignee's candidate workers (may be zero, one, or several).
  3. **Continuity check**: if `track_sessions` (1086) already has a row for
     `(track_number, worker_id)` where `worker_id` is one of the candidates,
     only that worker may claim the track — it already has the session/
     context for this track.
  4. **No prior session**: any idle candidate worker may claim it
     (first-idle-wins among the assignee's pinned workers).
  5. If no pin exists at all for the resolved assignee → claim normally
     (today's open behavior), so single-worker/unpinned projects need zero
     config.
- This means a single developer's tracks can run in parallel across their
  several pinned workers, while a given track always sticks to whichever
  worker already has its session going.

**REQ-4: UI**
- Track card/detail panel: "Assignee" control, showing name + resolved
  worker's live status (idle/busy/offline).
- Workers list: "Pin as mine" per worker, scoped per project, shows which
  pin (if any) is currently active for the logged-in user.
- Assignee's pinned worker offline → track visibly sits in `queue` (not
  silently stuck); no special UI state required beyond showing the worker as
  offline.

## Acceptance Criteria

- [ ] `lc worker start --worker-number <n>` runs a second concurrent worker
      process for the same project on the same machine
- [ ] Restarting a worker (same hostname + worker_number) reuses the same
      `workers.id` row rather than creating a new one
- [ ] Existing single-worker setups (no `--worker-number` passed) behave
      identically to today with zero config
- [ ] `worker_pins` and `tracks.assignee_uid` migrations applied
- [ ] A developer can pin more than one worker to the same project
- [ ] A track with an explicit assignee is only claimed by one of that
      assignee's pinned workers (verified with 2+ workers pinned by one
      developer, and with 2+ workers registered to one project overall)
- [ ] A track with an existing `track_sessions` row is only claimed by the
      worker already holding that session, even if the assignee has other
      idle pinned workers
- [ ] Two tracks assigned to the same developer, with no prior sessions, can
      be claimed by two different idle pinned workers simultaneously
- [ ] A track with no assignee defaults to creator, then project owner
- [ ] A track whose resolved assignee has no pin is claimable by any online
      worker (regression check against current behavior)
- [ ] Reassigning a track in the UI changes which developer's workers are
      eligible to claim it
- [ ] Existing single-worker projects behave identically to before this
      change with zero configuration
