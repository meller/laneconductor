# Spec: Worker reset, reconcile, model-staleness, and lock-crash bugs

## Problem Statement
Four independent, live-reproduced bugs in the worker/sync engine, found while
dogfooding track 1116 through its full plan→implement→review→quality-gate→
merge lifecycle in this same session. Each was confirmed against real log
output and real process state, not inferred. Together they mean: a track can
finish real, correct work and have that work either misreported as stuck,
silently dropped from sync, or lost entirely when an unrelated worker process
on the same machine restarts or crashes — with no automatic recovery and no
alert beyond a human happening to notice the mismatch.

## Requirements

### Bug 1 — unscoped project-wide stuck-reset on worker startup
- **REQ-1**: `resetStuckActions(true)` (`conductor/laneconductor.sync.mjs:2518`)
  fires unconditionally on every worker process startup. The SQL it triggers
  (`POST /tracks/reset-stuck-actions`, `ui/server/index.mjs:2720`, `immediate`
  branch) resets **every** track in `running`/`queued` state for the whole
  `project_id` — no `claimed_by`-scoping, no liveness check against the
  claiming worker or its recorded git-lock PID (`.conductor/locks/{N}.lock`
  already stores `{pid, hostname, started_at}` — the data needed exists,
  it's just not consulted here).
- **REQ-2**: Fix: scope the immediate reset to tracks actually owned by the
  *specific worker identity* that is starting up (its own prior `claimed_by`,
  not the whole project) — matching the code comment's own stated intent
  ("worker starts fresh, owns no running tracks") rather than the broader
  SQL that currently implements "reset everything in this project."
- **REQ-3**: No regression to the *legitimate* purpose of `immediate=true` —
  a worker that crashed mid-run and is now restarting must still be able to
  release its own genuinely-abandoned claims on startup.

### Bug 2 — orphan-reconcile's mismatch guard has backwards logic
- **REQ-4**: The guard at `conductor/laneconductor.sync.mjs:5121`
  (`[orphan-reconcile] Skipping artifact copy for track {N} — worktree lane
  "{X}" doesn't match dispatched action "{Y}"`) must distinguish a worktree
  lane that has **legitimately advanced** past the dispatched action via a
  known `workflow.json` `on_success`/`on_failure` transition (expected — copy
  normally) from one that's genuinely inconsistent (behind, or not a valid
  transition target — real anomaly, worth flagging for a human rather than
  silently copying or silently skipping).
- **REQ-5**: Reuse `workflow.json`'s transition table to validate "is `{X}`
  a legal successor of `{Y}`" rather than a blind string-equality check.

### Bug 3 — stale static model presets override live discovery
- **REQ-6**: `refreshModels()` (`conductor/laneconductor.sync.mjs:454`) must
  stop unconditionally appending `PROVIDERS[cli].models` presets on top of a
  **successful** live discovery result. A successful `discoverAvailableModels`
  call that omits a given model id is itself the signal that model is no
  longer available — the current merge (`combined.push(preset)` for every
  preset not already present) silently overrides that signal.
- **REQ-7**: Presets should only be used as a fallback when discovery itself
  failed/returned nothing for that provider (today's existing `null` → `[]`
  path) — not layered on top of a working discovery result.
- **REQ-8 (related, decide scope at implementation)**: a launch-time CLI
  crash (invalid `--model`, before the skill's own logic ever runs) is
  currently handled by the generic exit path as a same-lane re-queue, not
  `workflow.json`'s `on_failure` transition. Confirm whether this is
  intentional (a crash isn't a review/quality-gate *verdict*, so maybe it
  shouldn't consume a retry the same way) or should route through
  `on_failure` like any other failure — this needs a decision, not an
  assumption.
- **REQ-9 (optional, scope at planning)**: `cachedModels` is an in-memory,
  per-worker-process variable — every worker process (this repo commonly
  runs 5+) independently shells out to `claude models list` on its own
  schedule. Evaluate whether a shared/persisted layer is worth building now
  or is out of scope for this track.

### Bug 4 — uncaught lock-refresh exception kills the entire worker daemon
- **REQ-10**: `acquireWorkerLock()` (`conductor/services/worker-lock.mjs:44-54`)
  calls `lockfile.lock(lockTargetPath, { stale: staleMs, retries: 0 })` from
  the `proper-lockfile` package without an `onCompromised` option. Confirmed
  in the installed dependency
  (`node_modules/proper-lockfile/lib/lockfile.js:213`): the library's
  default is `onCompromised: (err) => { throw err; }`, fired from the
  library's own internal async mtime-refresh timer — **outside** any
  try/catch in `acquireWorkerLock` (which only wraps the initial `.lock()`
  call, not the ongoing refresh). That throw is genuinely uncaught at the
  process level, so Node's default behavior terminates the whole daemon —
  confirmed live twice in this session (`.sync.log`:
  `[fatal] Uncaught Exception: Unable to update lock within the stale
  threshold`, immediately followed by worker de-registration, both times
  killing whatever track dispatch was in flight).
- **REQ-11**: Pass an explicit `onCompromised` handler to `lockfile.lock()`
  that logs the failure and lets the process exit *cleanly* (or attempts a
  bounded re-acquire) instead of an uncaught throw. Whatever in-flight
  dispatch was running when this fires should be left in a recoverable
  state, not just silently killed with the parent.
- **REQ-12 (defense in depth, not a substitute for REQ-11)**: consider
  whether the process that starts the worker (`lc worker start` /
  `bin/lc.mjs`) should auto-restart on unexpected exit, the way a
  supervised production daemon normally would. `lc worker status` currently
  shows `STOPPED` after a crash with no automatic recovery — evaluate scope
  at planning, this may be a separate follow-up rather than in this track.

## Acceptance Criteria
- [ ] A track actively running under a live worker (recorded PID still
      alive, or `claimed_by` matches a currently-registered worker) is never
      marked `stuck_timeout` merely because a *different* worker process
      started up during that run.
- [ ] A worker that crashed mid-run still has its own genuinely-abandoned
      claims released on its own next startup (REQ-3 — no regression).
- [ ] A successful lane-action run whose worktree lane legitimately advanced
      per `workflow.json`'s `on_success`/`on_failure` table has its artifacts
      copied to the primary checkout automatically — no manual reconciliation
      needed (this track's own dogfood incident, reproduced live, must not
      reproduce again under the same conditions).
- [ ] A worktree lane that is genuinely inconsistent (not a valid transition
      from the dispatched action) is still flagged rather than blindly
      trusted — REQ-4/5 add a real distinction, not remove the guard.
- [ ] A worker's live-reported `available_models` for a provider never
      includes a model id that a successful discovery call did not itself
      return.
- [ ] An uncaught `onCompromised` throw from the lock library no longer
      crashes the whole worker process — verified by forcing a compromised
      lock in a test (e.g. deleting/touching the lock file externally during
      an active hold) and confirming the process logs and survives rather
      than exiting.
- [ ] Existing worker-lock tests (if any) and the full `conductor/tests/*`
      suite still pass with no new failures.

## API / Data Models
No new schema. All four fixes are logic-only changes within
`conductor/laneconductor.sync.mjs`, `ui/server/index.mjs`, and
`conductor/services/worker-lock.mjs`.

## Open Questions (resolve during planning-phase implementation, not here)
1. REQ-2's exact scoping mechanism: filter by `claimed_by` identity vs. by
   git-lock PID liveness vs. both — pick one, document why.
2. REQ-8: does a launch-time crash consume a retry / follow `on_failure`,
   or is today's same-lane re-queue actually correct for this specific
   failure class?
3. REQ-9: in/out of scope for this track — a shared model-discovery cache
   is a bigger change than the other three bugs combined.
4. REQ-12: in/out of scope for this track vs. a separate follow-up track.
