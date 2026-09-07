# Spec: Live turn cancellation and abort control in Chat surface

## Problem Statement

A worker spawns every lane action and every conversation reply as a **detached,
stdin-less** CLI child:

```js
spawn(command, args, { detached: true, stdio: ['ignore', out, out], cwd: worktreePath || process.cwd(), env })
```
`conductor/laneconductor.sync.mjs:5822`

Once that child is running there is exactly one thing in the entire system that
can stop it: the spawn-timeout killer at `:5858`, which fires only after the log
file has been quiet for the full timeout window (default 300s). A human watching
the Chat surface see the model going in a wrong direction has **no control at
all**. The available workarounds are all worse than the problem:

| Workaround | Why it's not an answer |
|---|---|
| Wait for the timeout | Only fires on *stalled* runs. A run that is confidently producing wrong output never stalls, so it never gets killed. |
| `lc worker stop` | Kills the worker, not the child. The child is detached — it keeps running, orphaned, and now nothing will ever finalize it. |
| Send a chat message | Track AM-10069 D1: queued for the *next* turn. Does nothing to this one. |
| `kill` by hand | Requires finding the pid, and leaves the git lock held, the track stuck at `lane_action_status: 'running'`, and no record of what happened. |

Track AM-10069 explicitly deferred this (spec.md D1). D1's reasoning was about
*injecting* into a live turn, which genuinely needs piped stdin and
`--input-format stream-json`. **Cancelling a live turn needs none of that** —
the process group is already addressable, and the liveness record needed to
address it safely already exists on disk.

### What already exists (verified live against this checkout, 2026-09-07)

This is most of the mechanism. The gap is narrower than the scope statement implies.

| Fact | Evidence |
|---|---|
| Every spawned run writes a durable, cross-process liveness record naming its **pid and pgid** | `buildRunMarker({ pid, pgid: proc.pid, worker_pid, ... })` → `conductor/.runs/<track>.json` (`:5905`); `detached: true` makes the child its own process-group leader |
| A safe "is this marker's process really still that process" check already exists | `isRunMarkerLive()` — pid alive **and** `ps -p <pid> -o args=` still matches the recorded command, specifically so pid reuse can't make a dead run look live (`run-marker.mjs`) |
| Killing a whole detached process group is already done in this file | `process.kill(-proc.pid, 'SIGTERM')` — the timeout killer (`:5860`) |
| SIGTERM→SIGKILL escalation with a grace window is already an established pattern | the orphan reaper (`:8296`–`:8322`) |
| The exit handler already releases the git lock, the main-mode lock and the local-fs claim marker on **every** exit path, success or not | `releaseTrackClaim` (`:5987`), `releaseGitLock` / `releaseGlobalMainModeLock` (`:6632`) |
| The worktree is already preserved across a non-success exit | `per-cycle` lifecycle: "Preserving worktree for track N" (`:6655`) |
| A non-terminal "stop and wait for a human" outcome is already a first-class lane state, with a documented reason and an un-park route | track 10055's `isParked` / `waitingReason` / `POST /api/projects/:id/tracks/:num/resume` |
| A conversation run already clears `**Waiting for reply**` on *any* exit | exit handler block 3b (`:6417`) — unconditional, so an aborted reply cannot loop |
| The manager pseudo-track is already addressable through the ordinary track routes | `isManagerPseudoTrack(req.params.num)` branches in `/api/projects/:id/tracks/:num/comments` |

So scope item 2 ("releases locks, avoids corrupted repository state") is
**already true** for any exit, and this track's job there is to *prove* it with
tests rather than build it. What is genuinely missing is three things: a way to
ask for the kill, a way to signal the group safely, and — the part with the most
design risk — making the resulting exit mean *"a human stopped this"* instead of
*"this run failed"*.

### The failure-semantics trap

A killed child exits with `code: null, signal: 'SIGTERM'`. Fed through the
existing exit handler unchanged, that is indistinguishable from a crash, and
every downstream consequence is wrong:

1. `isSuccess = code === 0` → false → a **retry is consumed** (`failCountBefore`).
2. At max retries, `lanes.<lane>.on_failure` fires — a cancelled `implement` run
   lands in `implement:failure`; a cancelled `quality-gate` run is sent back to
   `plan:queue`, discarding the whole review cycle.
3. A comment is posted reading `⚠️ Automation failed (PID: N, Exit Code: null)`,
   which is a lie about what happened.
4. Below max retries the track returns to `<lane>:queue` — so an `**Auto Run**:
   yes` track is **immediately re-claimed and the cancelled run restarts**. The
   user's cancellation accomplishes nothing except burning a retry.

Point 4 is the reason this track cannot be "add an endpoint that calls kill".

## Solution

Three parts, each reusing an existing mechanism rather than adding a parallel one.

**1. The request is written to the run marker, then the group is signalled.**
`conductor/.runs/<track>.json` is already the cross-process record of a live run
and is already read by the exit handler. Recording `abort_requested` there — as a
read-modify-write, before any signal is sent — makes the intent survive the kill
and be readable by the worker process that owns the child, which is a *different
process* from the one servicing the HTTP request. No new channel, no new state store.

**2. Signalling is a pure, injectable module** (`conductor/services/run-abort.mjs`),
guarded by `isRunMarkerLive` so a recycled pid can never be signalled, and
escalating SIGINT → SIGTERM → SIGKILL. SIGINT leads because it is what `Ctrl+C`
sends and gives the CLI its best chance to flush the transcript it has already
written; the escalation exists because two of the 24 leaked workers observed live
ignored SIGTERM outright (`:8237`).

**3. An abort is a park, not a failure.** The exit handler learns one new
outcome, `abortedByUser`, sitting alongside the `endedMidWork` and
`agentReportedWaiting` branches it already has. It suppresses the retry
increment, the `on_failure` transition and the "Automation failed" comment, and
routes into the **existing** park path: `<lane>:waiting`, `waiting_reason:
"Cancelled by user"`, `lane_action_result: 'aborted'`. `waiting` is chosen over
`queue` deliberately — `queue` is auto-claimable, and re-launching the run a
human just stopped is the single worst possible outcome of a Stop button. The
un-park route already exists and needs no new UI: `POST .../resume`.

The UI is then a thin affordance: a Stop button in `TurnStatusBar`, driven by
the liveness `ChatView` already computes.

### Scope boundary: co-located only

The abort endpoint signals a process on the machine the API server is running
on. That covers **local-api**, the documented dominant mode. It does **not**
cover **remote-api**, where the collector is in the cloud and the worker's
process group is on the user's laptop — an unreachable pid. Closing that needs a
`worker_dispatch`-routed abort action consumed by `checkDispatchInbox`, which is
a different mechanism with its own latency characteristics (10s poll) and its
own claim/reap semantics. It is **deferred to Phase 6, unimplemented**, is not an
acceptance criterion of this track, and the endpoint must say so explicitly
rather than silently no-op — see REQ-9.

## Requirements

**Abort primitive (scope 1)**
- REQ-1: `conductor/services/run-abort.mjs` is a pure module with no process-global
  state, taking its OS probes (`isPidAlive`, `readProcessCommand`, `kill`, `now`)
  as injected parameters, mirroring `run-marker.mjs`'s testability style.
- REQ-2: `writeAbortIntent(marker, { requestedBy, now })` returns a new marker
  object carrying `abort_requested: true`, `abort_requested_at`, `abort_requested_by`.
  It is a read-modify-write over the marker already on disk — it must preserve
  every existing field (`pid`, `pgid`, `worker_pid`, `action`, `command`,
  `started_at`), because the exit handler and `reconcileOrphanedDispatches` both
  still depend on them.
- REQ-3: `readAbortIntent(marker)` returns the intent or null; a marker with no
  `abort_requested` field classifies as no-intent, so every marker written before
  this track behaves exactly as it does today.
- REQ-4: `signalRunGroup(marker, { stage, isPidAlive, readProcessCommand, kill })`
  refuses to signal unless `isRunMarkerLive(marker)` reports live, and refuses any
  `pgid` that is not an integer `> 1`. On refusal it returns a reason and sends
  nothing. Signals are sent to the negated pgid (`kill(-pgid, sig)`), never to a
  bare pid.
- REQ-5: Escalation order is `SIGINT` → `SIGTERM` → `SIGKILL`. A stage escalates
  only if the group is still live after its grace window. Grace windows are
  configurable (`LC_ABORT_SIGINT_GRACE_MS`, `LC_ABORT_SIGTERM_GRACE_MS`; defaults
  5000/5000) following the `LC_SPAWN_TIMEOUT_MS` env-override-first precedent.

**API endpoint (scope 1)**
- REQ-6: `POST /api/projects/:id/tracks/:num/abort` resolves the project's
  `repo_path`, reads `conductor/.runs/<num>.json` beneath it, and on a live marker
  writes the abort intent **before** sending the first signal, so the intent is on
  disk no matter how fast the child dies.
- REQ-7: `:num` of `manager` is handled by the same route via `isManagerPseudoTrack`,
  reading `conductor/.runs/manager.json` and performing no DB track lookup and no
  lane reconciliation — the pseudo-track has no `tracks` row by design.
- REQ-8: Responses are explicit, never a silent no-op: `202` with
  `{ ok: true, pid, pgid, signal }` on a signal sent; `202` with
  `{ ok: true, already_requested: true }` on a repeat call for a still-live run
  (which also escalates a stage); `409` with a reason when no live run exists;
  `404` when the project or marker directory cannot be resolved.
- REQ-9: When the marker's `pid` is not a process on this machine — the
  remote-api case — the endpoint returns `501` naming the deferral explicitly,
  rather than reporting an abort it did not perform.
- REQ-10: `lc abort <track>` exposes the same primitive without an HTTP server, so
  it works in `local-fs` mode (where no API server exists at all).

**Non-failure semantics (scope 2, scope 4)**
- REQ-11: `spawnCli`'s exit handler captures the exit **signal** alongside the code
  (`proc.on('exit', (code, signal) => …)`), and re-reads the run marker it already
  reads for `markRunFinalizing` to determine `abortedByUser`.
- REQ-12: `abortedByUser` requires **both** an `abort_requested` intent on the
  marker **and** a signal-caused exit. A run that completes successfully (`code
  0`) in the race window between the intent write and the signal landing is
  reported as the success it was, never as a cancellation.
- REQ-13: An aborted run does **not** consume a retry, does **not** evaluate
  `lanes.<lane>.on_success` or `on_failure`, and does **not** change `**Lane**`.
- REQ-14: An aborted run parks: `**Lane Status**: waiting`, `waiting_reason`
  `"Cancelled by user"`, `lane_action_result: 'aborted'` — reusing track 10055's
  existing `isParked`/`writeWaitingReason` path, not a parallel one. `POST
  .../resume` is the documented way back, and works unmodified.
- REQ-15: The generic `⚠️ Automation failed (PID: N, Exit Code: …)` comment is
  suppressed for an abort and replaced by
  `> **system**: ⚠️ Turn cancelled by user — the running <action> was stopped. The
  worktree and session are preserved; use Resume to re-queue.`, per the
  Completion Comment Convention (leading `⚠️`, author `system`, one comment).
- REQ-16: An aborted **conversation run** (`local-fs-answer`) writes no lane or
  lane-status change at all (`getConversationRunWriteScope` already forbids it)
  and leaves `**Waiting for reply**: no` — so the reply is not immediately
  re-dispatched on the next cycle. This is existing block-3b behaviour; the
  requirement is that abort does not break it.
- REQ-17: The git lock, the global main-mode lock and the local-fs claim marker
  are released, the run marker is removed, and the worktree is preserved under
  `per-cycle` lifecycle — all on the abort path. No new code; this is a
  requirement to **verify** existing behaviour holds for a signal-caused exit.

**UI (scope 3)**
- REQ-18: `TurnStatusBar` renders a Stop control when a run is live, and renders
  the bar itself when a run is live even if no stream-json turn data has arrived
  yet (today `if (!turn) return null` hides it entirely for a non-claude or
  just-started run).
- REQ-19: `ChatView` passes the liveness it **already computes**
  (`resolveTargetRunLiveness`) and an abort handler; it does not compute liveness
  a second way.
- REQ-20: The button has three visible states — idle, in-flight ("Stopping…",
  disabled), and error (the endpoint's own message surfaced, not swallowed). A
  409 renders as "nothing running", not as a failure.
- REQ-21: Abort is available on a manager target on the same terms as a worker
  target, since REQ-7 makes the endpoint accept it.

## Acceptance Criteria

Each criterion is an observable user-facing outcome. None is satisfiable by a stub.

- [ ] AC-1: With a real lane action running on a track, clicking Stop in the Chat
      surface ends the CLI process group within the SIGINT grace window, and `ps`
      shows no surviving member of that group.
- [ ] AC-2: After AC-1, the track shows `<same lane>:waiting` with the reason
      "Cancelled by user" — the lane is unchanged, and the board does not show
      the track as failed.
- [ ] AC-3: After AC-1 on an `**Auto Run**: yes` track, the track is **not**
      re-claimed and no replacement run starts. Observed by letting the worker run
      several full poll cycles and asserting no new dispatch log appears.
- [ ] AC-4: After AC-1, the retry count for that lane is unchanged from before the
      cancellation.
- [ ] AC-5: After AC-1, `conversation.md` contains exactly one new `system` turn,
      leading with `⚠️`, saying the turn was cancelled by the user — and does
      **not** contain the "Automation failed" comment.
- [ ] AC-6: After AC-1, the track's git lock file is gone, `git status` in both the
      primary checkout and the worktree is clean of merge/rebase state, and the
      worktree still exists with the agent's partial work in it.
- [ ] AC-7: `POST .../resume` on the cancelled track returns it to
      `<same lane>:queue` and a worker claims and runs it again — the cancellation
      is recoverable, not a dead end.
- [ ] AC-8: Cancelling a live **conversation reply** stops it, and the worker does
      not re-dispatch a reply for that track on subsequent cycles.
- [ ] AC-9: Cancelling with nothing running returns 409 and the UI says nothing is
      running, rather than appearing to succeed.
- [ ] AC-10: A marker whose recorded pid has been reused by an unrelated process
      is never signalled — the endpoint reports no live run instead.
- [ ] AC-11: The Stop control is visible on a live manager-target turn and aborts it.
- [ ] AC-12: `lc abort <track>` cancels a live run in `local-fs` mode with no API
      server running.

## API Contracts

```
POST /api/projects/:id/tracks/:num/abort
  :num — a track number, or the literal `manager`
  body — {} (no parameters)

  202 { ok: true, pid, pgid, signal: 'SIGINT'|'SIGTERM'|'SIGKILL', already_requested?: true }
  409 { error: 'no live run for track <num>' }
  404 { error: 'Project not found' }
  501 { error: 'run is not on this machine — remote abort is not implemented (track 10079 Phase 6)' }
```

## Data Model Changes

No schema change. `tracks.lane_action_result` gains one new **value**, `'aborted'`
(the column is free-text `TEXT`; existing values include `success`,
`ended_mid_work`, `provider_exhausted`, `max_retries_reached`, `error (code N)`).
`tracks.waiting_reason` is reused as-is.

The run marker gains three optional fields (`abort_requested`,
`abort_requested_at`, `abort_requested_by`). It is a gitignored per-run runtime
artifact, and `parseRunMarker` is already tolerant of unknown shapes, so no
migration and no compatibility break: a marker without them classifies as
no-intent, byte-identically to today.

## Non-Goals

- **Mid-stream injection into a live turn** — still out of scope, unchanged from
  AM-10069's D1. Stopping a turn and steering one are different problems.
- **Aborting a run on a different machine (remote-api)** — needs a
  dispatch-routed abort action. Deferred to Phase 6, explicitly unimplemented,
  and surfaced as a `501` rather than a silent success (REQ-9).
- **Aborting a worker process itself** — `lc worker stop` and
  `POST /api/workers/:id/stop` already do that, and are a different intent.
- **Resuming a cancelled run mid-session.** Resume re-queues the lane action,
  which cold-starts or `--resume`s per the existing session rules. Rewinding to
  the exact interrupted point is not offered.
