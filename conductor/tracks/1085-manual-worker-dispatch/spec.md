# Spec: Manual Worker Dispatch (Track 1085)

## Problem Statement

`sync-only` mode intentionally disables auto-claiming from the general queue,
but that also removes any way to explicitly tell a specific worker to run a
specific action right now. Today the only way to get a `sync-only` worker to
do anything is to switch it to `sync+poll` and let the open-claim race decide
who picks up the work.

## Requirements

**REQ-1: Dispatch inbox**
- New table `worker_dispatch (id SERIAL, worker_id INTEGER REFERENCES workers(id), track_number TEXT NULL, action TEXT, payload JSONB NULL, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), claimed_at TIMESTAMPTZ)`.
- `status` transitions: `pending` → `claimed` → `done` (or `failed`).
- `track_number` is nullable: lane actions (REQ-3) are track-scoped, but
  `deploy` (REQ-5) and other project-level actions have no associated track.
  `payload` is a generic per-action parameter bag (e.g.
  `{"environment": "prod"}` for deploy) rather than a dedicated column per
  action type — track 1089 (remote worker provisioning) is the second
  consumer of this, needing `{"target_host": ..., "worker_number": ...}`.

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

**REQ-4: API + UI (lane actions)**
- `POST /api/tracks/:id/dispatch { worker_id, action }` — enqueues an entry,
  validates the action is legal for the track's current lane.
- Track detail panel: `Run on worker: [worker ▾] [action ▾] [Run Now]`,
  worker dropdown defaults to one of the track's resolved assignee's own
  workers (`workers.user_uid`, track 1084), action dropdown limited per
  REQ-3.
- Button disabled/hidden if the resolved worker has no valid action for the
  current lane, or is offline.

**REQ-5: Deploy as a dispatchable, project-level action**
- Deploying today (`lc deploy <env>`) only runs from whoever's terminal has
  the repo checked out and `conductor/deploy.json` configured — there's no
  UX for triggering it from the app at all. Reuse the same dispatch inbox
  (REQ-1/REQ-2) instead of building a separate mechanism: `action: 'deploy'`
  with `track_number: null` and `payload: {"environment": "prod"}`.
- Worker-side: on claiming a `pending` entry with `action === 'deploy'`, read
  `conductor/deploy.json`, run the configured command(s) for
  `payload.environment` (same logic `lc deploy` already runs in
  `bin/lc.mjs` — extract it into a shared function both the CLI and the
  worker call, rather than duplicating it), log to
  `conductor/logs/deploy-<env>-<timestamp>.log` (same convention as the
  existing CLI command). Mark `done`/`failed` from the exit code.
- API: `POST /api/projects/:id/dispatch { worker_id, action: 'deploy', payload: { environment } }`
  — project-level, not track-scoped; validates `payload.environment` exists
  in `deploy.json`.
- UI: a project-level "Deploy" control (not on a track detail panel, since
  deploy isn't tied to one track's lane) — `Deploy: [worker ▾] [environment ▾]
  [Deploy Now]`, worker dropdown limited to the calling developer's own
  workers for this project (`workers.user_uid`, track 1084), since deploying
  needs the repo checkout a worker already has.
  Natural home: the Workers list, or a project-level settings/actions panel.

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
- [ ] `Deploy Now` on a project dispatches to one of the developer's own workers, which runs the
      configured `deploy.json` command(s) for the chosen environment and
      logs output to `conductor/logs/deploy-<env>-<timestamp>.log`
- [ ] Deploy dispatch to a worker with no `deploy.json` (or an unconfigured
      environment) fails clearly, not silently
