# Spec: A Written Lane Change Can Be Silently Reverted by a Stale Concurrent Auto-Launch Dispatch or DB Pull

## Problem Statement

A correct, freshly-written `**Lane**` change — from `lc plan NNN`, `lc move`, a track-detail
panel drag, or a chat turn's own `/laneconductor move` — can be silently reverted to the track's
*previous* lane within seconds, in both `index.md` and the database, with no error anywhere. The
card appears to "snap back" on the Kanban board.

Confirmed live and reproduced repeatedly on track AM-10089 on 2026-09-11:

- `lc plan 10089` wrote `**Lane**: plan` and fired a file→DB sync every time (the same
  "Moved to plan (via file sync)" comment appeared 5+ times in the UI Conversation tab).
- Within seconds the track was back at `**Lane**: done`, in the file *and* the DB, each time.
- Caught directly once: the process actually dispatched immediately after the `plan` write was a
  **resumed session running `/laneconductor merge 10089`** — not `plan`. The auto-launch loop had
  decided *which lane action to run* from a snapshot that still read `done:queue`. That stale
  merge action then completed normally (a no-op — the code was already merged) and wrote
  `**Lane**: done` back over the correct value.

This is the lane-action counterpart of [[AM-10046-conversation-reply-overwrites-lane-with-stale-snapshot]].
Track AM-10046 closed this class of race for the **conversation-reply** path (`local-fs-answer`)
only — it explicitly gated the pre-spawn claim write, the prompt interpolation, and the exit
handler behind `waitingForReply`. The identical stale-snapshot hazard on the **normal lane-action
path** was never addressed, and is what this track fixes.

## Confirmed mechanism

### R1 — the pre-spawn claim write replays a stale whole-file buffer

`autoLaunchLocalFs` (`conductor/laneconductor.sync.mjs`) reads the candidate's `index.md` **once**
at the top of its per-directory loop iteration:

```js
const content = readFileSync(indexPath, 'utf8');
```

It then performs a long, genuinely awaited sequence before ever spawning:

| Step | Await | Typical cost |
|---|---|---|
| `buildCliArgs(...)` → `resolveTrackSession(trackNumber)` | HTTP to the collector | tens of ms |
| `POST /tracks/claim-queue` | HTTP + `FOR UPDATE SKIP LOCKED` | tens of ms |
| Cross-collector pre-spawn conflict check | one `GET /track/:n` **per non-primary collector**, 3000 ms timeout each | up to 3 s each |
| `patchTrackAction(... running)` mirror | fire-and-forget | — |

Only after all of that does it write the running claim:

```js
const runningContent = updateHeader(content, 'Lane Status', 'running');
writeFileSync(indexPath, runningContent, 'utf8');
```

`updateHeader` patches one marker **into the stale `content` buffer** and writes the **entire
buffer** back. Every edit any other writer made to `index.md` during that window — including a
`**Lane**: done` → `**Lane**: plan` change — is reverted wholesale. This is not a marker race; it
is a last-writer-wins whole-file clobber, and it is the single-worker-scoped staleness path the
problem statement predicted but could not locate.

### R2 — the dispatch decision itself is made from the same stale snapshot

`lane_status`, `lane_action_status`, `laneConfig`, `cmd_type`, `label`, the `**Auto Run**` /
`**Depends On**` / `**Waiting for reply**` gates, `resolveWorkspaceMode`, and the already-built
`cliArgs` all derive from that one snapshot. Nothing re-reads `index.md` between the snapshot and
`spawnCli`. So even with R1 fixed, the worker still spawns `/laneconductor merge` for a track that
now reads `plan:queue` — and **step 0 of every lane-action skill command instructs the agent to
claim the track by writing `**Lane**: <that lane>` itself**. The revert then arrives from the
agent, not from the worker, which is why it looks like a legitimate transition.

### R3 — the exit-handler guard is re-legitimized by R1

The exit handler already routes its lane write through `applyGuardedLaneWrite` with
`requireProducedForAnyChange: true` and

```js
producedByThisRun: preWriteOnDiskLane === laneStatus
```

That is correct *in isolation*: a merge run (`laneStatus = 'done'`) finishing against an on-disk
`plan` would compute `producedByThisRun: false` and be blocked. But R1's stale write has already
put `done` back on disk by then, so `preWriteOnDiskLane === 'done' === laneStatus` and the guard
passes the write as legitimate. R1 does not merely cause one revert — it disarms the containment
primitive built to stop exactly this.

### R4 — the DB→disk pull is forward-permissive and has its own TOCTOU window

`pullTracksMetadataFromDB` runs on its own 5 s `setInterval`. Its lane write goes through
`applyGuardedLaneWrite` with `producedByThisRun: false` and **without**
`requireProducedForAnyChange` — deliberately, per that call site's own comment, so a human
dragging a card forward in the UI still pulls. The consequence is that `plan` → `done` is a
*forward* write and is therefore **never blocked**. A stale DB row that a stale merge run just
PATCHed to `done` will overwrite a correct, freshly-written `plan` on the next pull.

Two things let it through:

- `isConcurrentEdit` gives only a **10 s** grace window (`conductor/sync-timestamp-utils.mjs`).
  A revert landing 11 s after the file write sails past it.
- `shouldPullFromDB`'s `content_summary_mismatch` trigger fires whenever the comparison is not
  `'older'` — which includes `'equal'` (a ±1 ms tolerance band).
- The `indexMtime` driving the decision is read **before** the per-track `await`s
  (`pullTrackContentFromDB`, `syncConversationFromDB`); `updateIndexMDFromDB` re-reads the file
  body but never re-checks whether the mtime that justified the pull is still current.

### R5 — nothing bounds how many distinct worker identities poll one project

`acquireWorkerLock` (`conductor/services/worker-lock.mjs`) makes a worker identity
(`project + worker_number`) exclusive. It does **not** bound how many *different* identities may
be alive and registered against one project. Each base identity independently runs its own 5 s
`pullTracksMetadataFromDB` and its own auto-launch claim loop, multiplying every window above by
N. `reapOrphanedWorkerProcesses` does not help: it is `isManager`-gated and only reaps
*unregistered*, *dead-cwd*, or *stale-heartbeat* processes — a healthy, registered, actively
heartbeating duplicate is invisible to it. `POST /worker/register` upserts on
`(project_id, hostname, worker_number)` and imposes no cap.

**Census performed during implementation (corrects the plan-phase's own open question)**: the
plan phase hypothesized that some observed identities (`105`, `106`, `20007`, `20008`, `20012`…)
might be **claim-scoped rows** rather than duplicate processes, on the theory that older code
used a smaller `CLAIM_WORKER_NUMBER_BASE_MULTIPLIER`. Checking `git log -S
CLAIM_WORKER_NUMBER_BASE_MULTIPLIER` against this repo's actual history disproves that: the
constant was introduced once, at `100000`, and has never changed. A claim-scoped row's
`worker_number` is therefore always `workerNumber * 100000 + slot` — at minimum `100001` for the
smallest possible base identity — so every one of `105`, `106`, `20007`, `20008`, `20012`,
`20014`, `20015`, `20018` is **structurally impossible** as a claim-scoped derivation. They are
exactly what the original problem statement said they were: genuine, independently-launched
`--worker-number` values, each a real base identity with its own OS process, its own 5 s
`pullTracksMetadataFromDB`, and its own auto-launch claim loop. The multi-identity theory is
therefore **confirmed, not disproven** — Phase 5 below targets the real population.

## Requirements

- **REQ-1**: A lane-action dispatch MUST re-read the track's `index.md` immediately before
  spawning, and MUST abandon the dispatch if `**Lane**`, `**Lane Status**`, `**Auto Run**`, or
  `**Waiting for reply**` changed since the snapshot the decision was made from.
- **REQ-2**: Abandoning a dispatch MUST release every claim it took — the primary collector's
  `lane_action_status` back to `queue`, the local-fs file claim removed — so the track is
  re-evaluated from fresh state on the next cycle rather than being stranded.
- **REQ-3**: The pre-spawn `**Lane Status**: running` write MUST be applied to a freshly-read
  buffer, never to the dispatch-time snapshot. No marker other than `**Lane Status**` may change
  as a result of that write.
- **REQ-4**: The exit handler's `producedByThisRun` determination MUST NOT be satisfiable by a
  lane value this same run's own pre-spawn write put on disk. It must be anchored to the lane
  recorded for this run at dispatch time (`conductor/.runs/<track>.json`).
- **REQ-5**: The DB→disk pull MUST NOT write a `**Lane**` value when `index.md`'s mtime has
  advanced past the mtime the pull decision was made from. Re-stat immediately before the write.
- **REQ-6**: The DB→disk pull MUST NOT overwrite a local `**Lane**` change that has not yet been
  pushed to the DB, in either direction — a forward write from a stale DB row is exactly as wrong
  as a backward one when the file is the fresher side.
- **REQ-7**: Every abandoned dispatch and every suppressed pull MUST be observable — a structured
  log line naming the track, the snapshot value, and the fresh value. Not a `conversation.md`
  comment (a stale process commenting every cycle is its own failure mode, per track 10040).
- **REQ-8**: A worker starting for a project that already has another live, heartbeating **base**
  identity on the same hostname MUST warn, and MUST refuse to start above a configurable cap
  (default: 1 base identity per project per host), unless explicitly overridden.
- **REQ-9**: The duplicate-identity check MUST distinguish base identities from claim-scoped rows
  and MUST NOT count the latter.
- **REQ-10**: No fix may introduce a new way for a legitimate transition to be *lost*. Abandoning
  a dispatch defers work by one cycle; it must never mark a track failed, blocked, or complete.

## Acceptance Criteria

- [ ] Running `lc plan NNN` on a track sitting at `done:queue`, while a worker is actively
      polling, leaves the track at `**Lane**: plan` — observed in `index.md` and in the UI — and
      the worker's next dispatch for that track is `/laneconductor plan`, not `/laneconductor
      merge`.
- [ ] With a dispatch deliberately delayed inside its pre-spawn window, a concurrent lane write
      to `index.md` survives: after the worker's cycle completes, the file still carries the
      concurrently-written lane, and no spawn occurred for the stale one.
- [ ] A DB row stale at `done` does not move a file freshly written to `plan`, at any delay past
      the 10 s concurrent-edit grace window.
- [ ] A lane action that legitimately completes still transitions the track normally — `plan`
      still reaches `plan:success`, `implement` still reaches `review:queue` — with no added
      latency beyond one poll cycle in the abandoned-dispatch case.
- [ ] Starting a second worker for a project that already has one live base identity on the same
      host prints a clear refusal naming the existing identity, and exits non-zero.
- [ ] The duplicate-identity count reported for a project with N concurrently-running lane
      actions under one worker is 1, not 1+N.

## API Contracts / Data Models

No schema changes. Two additive, backward-compatible surfaces:

- `conductor/.runs/<track>.json` (existing run marker, written by `spawnCli`) gains a
  `dispatch_lane` field recording the lane this run was dispatched for. Absent on markers written
  by older code — the exit handler falls back to today's behavior when it is missing.
- `GET /api/workers` responses are already sufficient for REQ-8/REQ-9; the base-vs-claim
  distinction is computed worker-side from `worker_number` against
  `CLAIM_WORKER_NUMBER_BASE_MULTIPLIER`, so no endpoint change is required.

New environment overrides, both test-facing:

| Variable | Default | Purpose |
|---|---|---|
| `LC_MAX_BASE_WORKERS_PER_PROJECT` | `1` | REQ-8 cap; `0` disables the check |
| `LC_ALLOW_DUPLICATE_WORKER` | unset | escape hatch for REQ-8 |

## Non-Goals

- Making a claim atomic across collectors. Non-primary collectors stay fire-and-forget
  (`conductor/product.md`); this track only narrows single-worker and primary-collector windows.
- A durable write-ahead log for suppressed pulls. A suppressed pull is re-evaluated on the next
  5 s tick from fresh state.
- Reworking `lane-regression-guard.mjs`'s rank model. R3 is fixed by anchoring
  `producedByThisRun` correctly, not by changing what the guard means.
- Auto-killing healthy duplicate worker processes. REQ-8 prevents accumulation at start time;
  reaping live, registered, heartbeating workers is a separate and riskier decision.

## Open Items for Human Review

- **Workspace mode.** This track modifies the sync worker that is *currently running and serving
  this project*. Per `conductor/workflow.md`'s Workspace Modes section, that is the documented
  case for `**Workspace**: main` — a fix on a branch does not take effect until merged and the
  worker restarted, which makes the acceptance criteria above unverifiable from a worktree. This
  plan does **not** set the marker (an inference must not masquerade as a deliberate choice); a
  human should set `**Workspace**: main` on this track if they want it verified against the live
  worker.
- **Verification requires restarting the live worker.** Several acceptance criteria cannot be
  satisfied without it. See `test.md`'s Environment Hazards.
