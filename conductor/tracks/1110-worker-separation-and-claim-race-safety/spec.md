# Spec: Worker process separation + atomic track claiming

## Problem Statement

Two related safety gaps in how `laneconductor.sync.mjs` workers start and
claim work, both found live on 2026-08-13 while dogfooding LaneConductor
against itself (see [track 1102](../1102-e2e-session-findings/index.md) F10).

**A — process separation.** `bin/lc.mjs`'s single-instance guard
(`getRunningWorkerPid()`) only ever consults the pidfile it is about to
overwrite. A stale, missing, or never-written pidfile makes `lc worker
start` believe nothing is running, so it spawns a second OS process for
an identity (`project_id`, `hostname`, `worker_number`) that already has
a live one. Reproduced live: a routine `make lc-stop && make lc-start`
left two processes running simultaneously, one of them mid-`implement`
on a real track.

**B — claim atomicity.** The function that decides which queued track a
worker runs next, `autoLaunchLocalFs()`, reads `index.md`'s
`lane_action_status` from disk, decides to claim, writes `Lane Status:
running` back to disk, then spawns the CLI — with no lock of any kind
between the read and the write. This function is used by **every** mode,
including local-api/remote-api (sync+poll) — confirmed by the worker's
own comment: *"Launch decisions are always filesystem-based... DB is used
only for heartbeats and UI sync, not for concurrency control."* A real,
tested, atomic claim endpoint (`POST /tracks/claim-queue`, `FOR UPDATE
SKIP LOCKED`) already exists but is never called by the worker's
auto-launch loop. Two worker processes for one project — exactly what
problem A can produce — can therefore both read `queue` in the same
5-second tick and both spawn a run for the same track.

These compound: A is how a duplicate process gets created; B is what
makes a duplicate process dangerous rather than merely redundant.

## Requirements

- REQ-1: `lc worker start` MUST refuse to start a second process for an
  identity (`project_id`/local-fs-equivalent, `hostname`, `worker_number`)
  that already has one running, even if the local pidfile is stale,
  missing, or was never written by `lc`.
- REQ-2: The mechanism satisfying REQ-1 MUST NOT depend on the pidfile
  being accurate — a process that dies without cleanup (kill -9, crash,
  OOM) must not leave a phantom "lock" that blocks all future starts.
- REQ-3: In local-api/remote-api mode, a track's claim (the transition
  from `lane_action_status: queue` to a state where exactly one worker
  is running it) MUST be atomic across any number of concurrent worker
  processes for the same project — no two workers may both spawn a CLI
  run for the same track from the same `queue` state.
- REQ-4: In local-fs mode (no DB available), REQ-3's guarantee MUST still
  hold, via a mechanism that doesn't require Postgres.
- REQ-5: Neither fix may change single-worker behavior — a project with
  exactly one live worker process must behave identically to today
  (same claim latency, same auto-launch cadence).

## Acceptance Criteria

- [ ] Two `lc worker start` invocations for the same identity, launched
      in quick succession, result in exactly one live process — the
      second exits with a clear "already running" message rather than
      starting a shadow process (REQ-1).
- [ ] Killing a running worker with `SIGKILL` (no graceful shutdown) does
      not prevent `lc worker start` from successfully starting a fresh
      one immediately after (REQ-2).
- [ ] With two worker processes deliberately run against one local-fs
      project directory (the Phase 1 reproduction), a track queued for
      auto-launch is claimed and run by exactly one of them — the mock
      CLI is invoked exactly once for that track, not twice (REQ-3, REQ-4
      via the local-fs path).
- [ ] The existing `local-fs-e2e.test.mjs` suite (parallelism,
      transitions, retries) continues to pass unmodified after the claim
      path changes (REQ-5).
- [ ] `ui/server/tests/track-1033-worker-auth.test.mjs`'s existing
      `claim-queue` tests continue to pass — the API-mode fix wires INTO
      that endpoint, it must not change its contract (REQ-3's API-mode
      half).

## Non-goals

- Redesigning worker identity/assignment (that's [1084](../1084-worker-identity-and-assignment/index.md))
  or claim authorization/scoping (that's [1109](../1109-worker-claim-allowlist/index.md)).
  This track is purely about **exclusivity**: at most one process per
  identity, at most one claimant per track.
- **Cross-machine locking — deliberately not needed, not just deferred.**
  In remote-api mode, two different machines can legitimately run a
  worker for the same project (raised and confirmed 2026-08-13). This
  does NOT reopen problem A: `workers`' own uniqueness constraint is
  `(project_id, hostname, worker_number)` — hostname is part of the
  identity, so "worker #1 on machine A" and "worker #1 on machine B" are
  two distinct identities that happen to share a number, not a collision.
  Phase 2's FS lock only ever needs to prevent duplication *within* one
  machine, because that's the only place a collision on one identity can
  occur — there is no filesystem shared between the two machines' locks
  to race over.
  Where the cross-machine case DOES bite is problem B (claim race): two
  distinct workers — same machine with different numbers, or different
  machines entirely — can still both try to claim the same queued track.
  That's exactly what Phase 3's fix already covers, and it's inherently
  cross-machine-safe *because* it wires into Postgres (`POST
  /tracks/claim-queue`, `FOR UPDATE SKIP LOCKED`) rather than anything
  local-filesystem-based — the DB is the one piece of state actually
  shared between machines in API mode. So Phase 3 isn't just "the
  API-mode fix," it's specifically what makes the cross-machine case
  safe; no separate distributed-lock work is needed on top of it.
