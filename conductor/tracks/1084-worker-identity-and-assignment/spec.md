# Spec: Worker Identity & Assignment (Track 1084)

## Problem Statement

Remote-mode track claiming is a race: every worker registered to a project
polls the same queue and claims whatever's unclaimed first. With multiple
developers each running their own worker, there's no way to route a track to
a specific person's machine.

## Requirements

**REQ-1: Worker pinning**
- New table `worker_pins (project_id, user_uid, worker_id, PRIMARY KEY (project_id, user_uid))`.
- A project member can pin exactly one worker per project at a time (upsert on repin).
- Settable from the Workers list UI ("Pin as mine" action, scoped to the current project).

**REQ-2: Track assignment**
- New column `tracks.assignee_uid` (nullable).
- If unset, the resolved assignee is the track's creator; if the creator is
  unknown, fall back to the project owner.
- Reassignable from the track card/detail panel to any project member.

**REQ-3: Claim-scoping**
- In `autoLaunchLocalFs` (and the equivalent API-mode claim path) in
  `conductor/laneconductor.sync.mjs`, before a worker claims a `queue`-status
  track:
  1. Resolve the track's assignee (REQ-2).
  2. Look up `worker_pins` for that (project_id, assignee_uid).
  3. If a pin exists and it is NOT this worker → skip the track.
  4. If a pin exists and it IS this worker → claim normally.
  5. If no pin exists for the resolved assignee → claim normally (today's
     open behavior), so single-worker/unpinned projects need zero config.

**REQ-4: UI**
- Track card/detail panel: "Assignee" control, showing name + resolved
  worker's live status (idle/busy/offline).
- Workers list: "Pin as mine" per worker, scoped per project, shows which
  pin (if any) is currently active for the logged-in user.
- Assignee's pinned worker offline → track visibly sits in `queue` (not
  silently stuck); no special UI state required beyond showing the worker as
  offline.

## Acceptance Criteria

- [ ] `worker_pins` and `tracks.assignee_uid` migrations applied
- [ ] Pinning a worker in the UI persists and is visible on reload
- [ ] A track with an explicit assignee is only claimed by that assignee's
      pinned worker (verified with 2+ workers registered to one project)
- [ ] A track with no assignee defaults to creator, then project owner
- [ ] A track whose resolved assignee has no pin is claimable by any online
      worker (regression check against current behavior)
- [ ] Reassigning a track in the UI changes which worker can claim it
- [ ] Existing single-worker projects behave identically to before this
      change with zero configuration
