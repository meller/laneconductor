# Spec: Lane action status transitions must reach every collector, not just the primary

## Problem Statement

A lane action that is genuinely running locally can appear as `queue`
("Queued for automation") on the remote collector indefinitely, and a lane
action that has finished can stay pinned at `running` on the remote
collector forever. Both were observed live on `app.laneconductor.com` on
2026-09-08 (see `index.md` for the raw evidence).

This is a correctness problem, not a display problem. `lane_action_status`
is the field `POST /tracks/claim-queue` filters on. A worker whose primary
collector is the remote one — a second machine, or a worktree-spawned
process (see TU-10064) — reads `queue`, wins the claim, and launches a
second concurrent lane action against a track that is already running. The
git lock and the global main-mode lock cannot prevent this: they are local
files on a machine the second worker has never seen.

## Root Causes

Three independent defects combine. Any one of them alone reproduces part
of the observed behaviour; all three are present today.

### RC-1 — Status transitions are addressed to the primary collector only

`conductor/laneconductor.sync.mjs`'s dispatch loop resolves its target once,
with `primaryCollector()`, and every `patch(url, token, ...)` inside the loop
therefore addresses `getCollectors()[0]`. For this project that is
`http://127.0.0.1:8091`. The write that flips `lane_action_status` to
`running` the instant a lane action starts is one of those calls. So is the
revert on spawn failure, the completion write, the timeout write, and the
orphan-reconciliation write.

The all-collector fan-out helpers (`postToCollectors`, `patchCollectors`)
already exist, already await the primary and fire-and-forget the rest,
already record per-collector health, and already queue failed non-primary
writes into the retry buffer. `patchCollectors` is called from exactly one
site in the whole worker.

### RC-2 — The cloud collector physically cannot record a status change from `POST /track`

This is why the indirect path — `syncTrack()` reading `index.md` and pushing
the full payload through `postToCollectors('/track', ...)` — does not rescue
the situation. It is not slow. It does nothing at all for this field.

`cloud/functions/index.js`'s `POST /track` builds its `ON CONFLICT` update as:

```sql
lane_action_status = CASE
  WHEN tracks.lane_action_status = 'running' THEN 'running'
  WHEN tracks.lane_status != EXCLUDED.lane_status THEN 'queue'
  ELSE tracks.lane_action_status
END
```

The payload's `lane_action_status` is bound as `$13` and is referenced only
in the `VALUES` list, so it applies on insert and never on update. On the
update path the new value is derived entirely from the row already in the
database. The consequences follow directly:

- A track sitting at `queue` whose lane has not changed takes the `ELSE`
  branch and stays at `queue`. **`running` can never arrive.**
- A track sitting at `running` takes the first branch and stays at
  `running`. **A stale `running` can never be cleared.**
- When `lane_status` is null the whole clause is omitted, so
  `lane_action_status` is not written on update under any circumstance.

That is both live symptoms in one clause: track 10080 stuck at "Queued for
automation" while genuinely running, and tracks 1097/1090/1080 stuck under
"RUNNING" after they had already reset themselves to `queue`.

The local collector does not behave this way. `ui/server/index.mjs` writes
`lane_action_status = $13` — the payload value — subject to the
human-override and lane-regression guards. The two collectors disagree about
what `POST /track` means.

### RC-3 — Claiming is atomic per collector, and only the primary is claimed

`POST /tracks/claim-queue` is a single `UPDATE ... FOR UPDATE SKIP LOCKED`
that flips `queue` to `running` and returns the winner. It is correct, and it
is correct on each collector independently. The worker calls it on the
primary only. Every other collector's row stays at `queue`, so the same track
is still claimable there.

Fixing RC-1 and RC-2 shrinks the exposure window from unbounded to roughly
one HTTP round trip. It does not make a claim atomic across two databases,
and this track does not pretend to. Closing the residual window needs a
second mechanism (see REQ-6).

## Supporting Findings

**F-1 — There is one `project_id` for all collectors, and it is last-writer-wins.**
`upsertWorker()` loops every collector, calls `POST /project/ensure` on each,
and on each iteration assigns `proj.id = project_id` and rewrites
`.laneconductor.json`. Whichever collector answers last determines the value
every subsequent call sends to every collector. The cloud's `checkProject`
middleware resolves the project from `req.body.project_id` scoped to the
caller's workspace and returns `403` when it does not resolve, so fanning a
body carrying the wrong collector's id at it fails closed. Any fan-out of a
`project_id`-bearing body must resolve the id per collector.

**F-2 — The file-watch path is slow, but slow is not the bug.**
`syncTrack()` is reached through a 250 ms per-file debounce and a
`MAX_CONCURRENT_SYNCS = 8` gate, and the watcher runs with
`ignoreInitial: false`, so a worker start enqueues roughly four syncs per
track before any live change is processed. Under the burst conditions of the
2026-09-08 session that is real added latency. It is not the cause: RC-2 means
this path could run instantly and the remote would still show the wrong
status. Scope item 3 from `index.md` is answered here and closed; no watcher
change is in scope.

**F-3 — `POST /track` on the cloud drops more than this one field.**
Its insert column list omits `waiting_for_reply`, `auto_run`, `merge_mode`,
`workspace_mode`, `log_content`, `model_override`, and every KPI column that
the local collector persists. Same divergence shape, wider blast radius. Out
of scope here; to be filed as its own track (see Non-Goals).

## Requirements

- **REQ-1**: `POST /track` on the cloud collector must apply the payload's
  `lane_action_status` to an existing row, so that a status pushed by
  `syncTrack()` actually lands. Its behaviour when the field is absent must
  stay as it is today: reset to `queue` on a lane change, otherwise leave the
  existing value alone.
- **REQ-2**: The sticky `WHEN tracks.lane_action_status = 'running' THEN 'running'`
  branch must be removed, and the change must be justified against whatever it
  was originally protecting. If it guards a real regression, an equivalent guard
  that a legitimate status write can pass must replace it, not merely survive
  alongside it.
- **REQ-3**: Every worker write that carries track state — `lane_status`,
  `lane_action_status`, `lane_action_result`, progress, PR fields — must reach
  every configured collector, through the existing `patchCollectors` fan-out,
  so per-collector health and the retry buffer apply to it.
- **REQ-4**: Writes that address a row that exists only on the primary must
  stay primary-only: every `/worker-dispatch/:id` call, `/tracks/claim-queue`,
  `/file-sync/:id`, the pre-spawn-block endpoints, and `/track/:num/lock`
  and `/unlock`. Fanning these out would address ids that mean nothing, or
  something different, on another collector.
- **REQ-5**: A fan-out must send each collector a `project_id` that resolves on
  that collector. `.laneconductor.json`'s `project.id` must stop being
  overwritten by whichever collector answered `/project/ensure` last.
- **REQ-6**: Immediately after winning a claim on the primary, the worker must
  mirror `lane_action_status: running` to every other collector; and before
  spawning, it must re-read the track from every other collector and abort the
  spawn if one reports the track already running under a different claimant.
  A collector that is unreachable or slow must never block the spawn — this is
  a guard against a confirmed conflict, not a quorum requirement.
- **REQ-7**: A non-primary collector that rejects or drops a status write must
  surface through the existing `collector_health` / "SYNC DEGRADED" machinery
  from track 10064. No status fan-out may fail silently.

## Acceptance Criteria

Each of these is something a person can observe without reading the diff.

- [ ] While a lane action is genuinely running on a local worker, opening the
      remote dashboard for that track shows it as running, within seconds of
      the run starting, on the first attempt after a fresh worker start.
- [ ] When that run finishes, the remote dashboard stops showing it as
      running. A track that has reset itself back to `queue` locally does not
      remain pinned under "RUNNING" on the remote dashboard.
- [ ] A worker pointed at the remote collector as its primary does not start a
      second lane action on a track that another worker is already running.
- [ ] Taking the remote collector offline for the duration of a lane action
      changes nothing about that run: it starts, completes, and lands on the
      correct lane, and the worker's card shows the degraded-sync badge rather
      than a failure.
- [ ] Once the remote collector comes back, the status writes it missed are
      replayed and the track's remote state matches its local state without
      anyone touching a file.
- [ ] `.laneconductor.json`'s `project.id` still names the local project after
      a worker start that talks to both collectors.

## API Contracts

**`PATCH /track/:num/action`** — unchanged on both collectors. Already
implemented on the cloud (`cloud/functions/index.js`) and on the local server
(`ui/server/index.mjs`), and already accepts `lane_action_status`,
`lane_action_result`, `lane_status`, `progress_percent`, `waiting_reason`.
This track changes who it is sent to, not what it is.

**`POST /track`** — request shape unchanged. The cloud's handling of
`lane_action_status` on the update path changes to match the local collector
(REQ-1).

**`GET /track/:num`** — used read-only by the pre-spawn guard (REQ-6). Exists
on both collectors already.

## Non-Goals

- Making a claim atomic across collectors. There is no distributed
  transaction here and this track does not add one. REQ-6 narrows the window
  and detects the conflict; it does not eliminate the race.
- Any change to the chokidar debounce or the sync concurrency gate. See F-2.
- The wider `POST /track` field-parity gap on the cloud collector (F-3). It
  needs its own track, its own migration review, and its own tests. A
  follow-up track is to be filed during Phase 6 and referenced here.
- A durable write-ahead log for collector writes. Track 10064 decided
  against this deliberately; the in-memory retry buffer is the mechanism.
