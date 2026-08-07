# Spec: Manual Worker Dispatch (Track 1085)

## Problem Statement

`sync-only` mode intentionally disables auto-claiming from the general queue,
but that also removes any way to explicitly tell a specific worker to run a
specific action right now. Today the only way to get a `sync-only` worker to
do anything is to switch it to `sync+poll` and let the open-claim race decide
who picks up the work.

## Requirements

**REQ-1: Dispatch inbox**
- New table `worker_dispatch (id SERIAL, worker_id INTEGER REFERENCES workers(id), track_number TEXT, action TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), claimed_at TIMESTAMPTZ)`.
- `status` transitions: `pending` → `claimed` → `done` (or `failed`).

**REQ-2: Worker-side polling**
- On every sync tick (the existing ~10s heartbeat interval in
  `conductor/laneconductor.sync.mjs`), a worker queries
  `worker_dispatch WHERE worker_id = me AND status = 'pending'`, regardless of
  `sync-only` vs `sync+poll` mode.
- A found entry is marked `claimed` and run through the same `spawnCli` path
  used by auto-launch (same context injection, logging, timeout handling).
- On process exit, mark `done` or `failed` consistent with existing lane
  action result handling.

**REQ-3: Scope**
- `action` is restricted to the lane actions the track's current lane
  actually supports (mirrors the set auto-launch already knows how to run:
  plan, implement, review, quality-gate). No freeform custom prompts in v1.

**REQ-4: API + UI**
- `POST /api/tracks/:id/dispatch { worker_id, action }` — enqueues an entry,
  validates the action is legal for the track's current lane.
- Track detail panel: `Run on worker: [worker ▾] [action ▾] [Run Now]`,
  worker dropdown defaults to the track's resolved assignee's pinned worker
  (track 1084), action dropdown limited per REQ-3.
- Button disabled/hidden if the resolved worker has no valid action for the
  current lane, or is offline.

## Acceptance Criteria

- [ ] `worker_dispatch` migration applied
- [ ] A `sync-only` worker picks up and runs a dispatched action without
      touching the general queue
- [ ] A `sync+poll` worker also honors dispatch entries (dispatch works in
      either mode)
- [ ] Dispatching an action invalid for the track's current lane is rejected
      by the API with a clear error
- [ ] UI shows Run Now only for actions valid in the current lane
- [ ] Dispatch entry status reflects actual run outcome (done/failed) and is
      visible somewhere in the UI (e.g. track's log/activity view)
