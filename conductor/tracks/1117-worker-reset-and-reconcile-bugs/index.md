# Track 1117: Fix unscoped worker-startup reset + backwards orphan-reconcile guard

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Phase 5: Full regression pass
**Type**: dev
**Summary**: Four compounding bugs, found and root-caused live during track 1116's dogfood run through implement/review/quality-gate, silently stranding successful work with no automatic recovery: (1) unscoped…

## Problem

Track 1116's `implement` dispatch ran to completion successfully — commit
`f9b9e65`, 18 passing tests, correctly transitioned to `review` lane inside
its worktree. Yet the DB (and therefore the UI board) showed it stuck at
`lane_status: implement, progress: 0%, lane_action_result: stuck_timeout`
for the entire run and after. Manually reconciled as a one-off (see track
1116's own history), but the underlying mechanism is broken for any track,
not just 1116.

**Bug 1 — `resetStuckActions(immediate=true)` is unscoped project-wide.**
`conductor/laneconductor.sync.mjs:2493` calls this unconditionally on
*every* worker process startup, with the comment "worker starts fresh, owns
no running tracks" — true for that one worker, but the SQL behind it
(`ui/server/index.mjs:2765`, `POST /tracks/reset-stuck-actions`) resets
**every** track in `running`/`queued` state for the whole project:
```sql
UPDATE tracks SET lane_action_status = 'queue', lane_action_result = 'stuck_timeout', claimed_by = NULL
WHERE project_id = $1 AND lane_action_status IN ('running', 'queue') AND claimed_by IS NOT NULL
```
No check against which worker `claimed_by` actually is, no check whether
that worker (or its recorded git-lock PID) is still alive. This repo
routinely has 5+ worker processes (multiple worker-numbers plus
worktree-scoped ones) — confirmed via `.sync.log`: 48 `immediate:true`
reset calls logged historically, meaning this fires constantly. Any one of
them starting up mid-run stomps every *other* legitimately-running track
project-wide. Confirmed live: this fired ~2 minutes into track 1116's
45-minute run (log timestamp ~14:59:35 UTC vs. dispatch claimed_at
14:57:45 UTC), while track 1116's actual worker (PID 442055, recorded in
`.conductor/locks/1116.lock`) was still alive and working.

**Bug 2 — orphan-reconcile's mismatch guard has backwards logic.**
`conductor/laneconductor.sync.mjs`, log line
`[orphan-reconcile] Skipping artifact copy for track {N} — worktree lane
"{X}" doesn't match dispatched action "{Y}"; leaving the primary's own
state untouched` — this guard is meant to protect against copying back an
*inconsistent* worktree (e.g. a crash mid-transition). But a **successful**
run is *supposed* to advance the lane (`implement` → `review`, per
`workflow.json`'s `on_success`) — so the one condition this guard is
designed to flag as suspicious is exactly what a clean success produces.
It skipped copying track 1116's artifacts specifically *because* the work
succeeded, permanently orphaning the correct, newer state in the worktree.

**Compounding interaction**: Bug 1 marks a live track `stuck_timeout` even
though it's genuinely still running. That misleading state is presumably
what makes a later `orphan-reconcile` pass (per the "Track 1110 Phase 6"
comment at `worktree-artifact-merge.mjs` — shared code path between the
exit-handler and a startup reconciliation pass) go looking at the worktree
at all. Bug 2 then refuses to trust what it finds there. Either bug alone
is a real problem; together they guarantee any track that finishes lane
action work while ANY other project worker restarts during its run ends up
silently stranded with no automatic recovery.

**Bug 3 — `refreshModels()` merges stale static presets back into live
discovery results.** `conductor/laneconductor.sync.mjs`'s `refreshModels()`:
```js
const combined = [...discovered];
for (const preset of presets) {
  if (!combined.some(m => m.id === preset.id)) combined.push(preset);
}
```
Even when live discovery (`discoverAvailableModels`, real `claude models
list` shell-out) succeeds and correctly *omits* a retired model, the static
`PROVIDERS[cli].models` preset for that same id gets unconditionally
appended back into `cachedModels` — which is what's reported to the DB as
`workers.available_models` and read by pickers as "genuinely available."
Confirmed live: `claude-3-5-haiku` (workflow.json's original `review`/
`quality-gate` `primary_model`, set by track 1111's population) showed up
in a worker's live-reported `available_models`, yet the real CLI rejected
it outright at spawn time (`"There's an issue with the selected model
(claude-3-5-haiku). It may not exist or you may not have access to it."`)
— an instant crash, `is_error: true`, before the skill's own logic ever
ran. `cachedModels` itself is also **not persisted anywhere reusable** —
it's an in-memory, per-worker-process variable, rebuilt independently by
every worker on startup and every 30 minutes; nothing centralizes or
shares it across the multiple worker processes this project runs.
Separately, a launch-time crash like this (never reaches the skill's own
review-verdict logic) got treated by the exit handler as a generic
re-queue back to the *same* lane rather than following `workflow.json`'s
`on_failure` transition — worth confirming intended behavior at planning
(is "CLI couldn't even start" supposed to look different from "skill ran
and returned FAIL"?).

**Bug 4 — an uncaught exception in the lock keep-alive kills the entire
worker daemon, with no auto-restart.** Confirmed live via `.sync.log`:
`[fatal] Uncaught Exception: Unable to update lock within the stale
threshold` — this fired twice in the same session (worker-number-1's
process: 442055 → crashed → replaced by 940987 → crashed again), each time
immediately followed by `[LaneConductor] Worker de-registered from
http://127.0.0.1:8091: meller-X1-AI (PID: {N})` and the process exiting
entirely. Whatever background interval refreshes the git-lock's liveness
timestamp (keeping `.conductor/locks/{N}.lock` from being reclaimed as
stale by another worker) throws instead of handling a failed refresh
gracefully — and that throw is uncaught, so Node's default behavior kills
the *whole* process, not just that one operation. The track being worked
(1116's `quality-gate` dispatch) died with it — its detached child `claude`
process did not survive (checked directly: no matching PID after the
crash). `lc worker status` afterward showed `STOPPED`; nothing restarted
it automatically. Recovered manually via `lc worker restart` +
re-dispatch. This is arguably the most severe of the four: it silently
takes down all in-flight work for a worker at once, and requires a human
to notice and restart.

## Solution (to be detailed at planning)
- Bug 1: scope the reset to tracks actually owned by a now-dead identity —
  either check `claimed_by` against the specific worker that's starting up
  (only reset tracks *that worker* previously claimed, not the whole
  project), or check the git-lock file's recorded PID for liveness before
  resetting (the lock already records this — `.conductor/locks/{N}.lock`
  has `{pid, hostname, started_at}`). Needs a decision on which scoping is
  correct given multi-machine/remote-api mode where PID liveness can't be
  checked locally — likely: reset by `claimed_by = <this worker's own
  identity>` only, never project-wide, matching the "I own no running
  tracks" reasoning that's already the actual justification in the code
  comment but not what the SQL implements.
- Bug 2: the mismatch condition should distinguish "worktree lane is
  *behind or equal to* the dispatched action" (real inconsistency — copy
  anyway or flag for human review) from "worktree lane has *advanced past*
  the dispatched action via a known `on_success`/`on_failure` transition"
  (expected outcome of success — copy normally). The workflow.json
  transition table already encodes valid forward transitions; reuse it
  rather than a blind equality check.
- Consider whether Bug 1's fix alone removes the need to touch Bug 2 (if
  tracks never get incorrectly marked stuck, orphan-reconcile may rarely
  see a real mismatch) — but Bug 2 is independently wrong regardless of
  Bug 1's frequency, so fix both.
- Bug 3: `refreshModels()`'s merge should only add a preset when discovery
  itself failed/returned nothing for that provider (today's `null` →
  `[]` fallback path), not when discovery succeeded but simply didn't
  include that id — a successful discovery's omission IS the signal a
  model is gone. Separately, consider whether `cachedModels` deserves a
  shared/persisted layer (e.g. one process refreshes, others read) instead
  of N independent shell-outs — worth scoping as its own decision, not
  assumed.
- Bug 4: find and fix the specific lock-refresh call site that throws
  "Unable to update lock within the stale threshold" — wrap it so a failed
  refresh is logged/retried rather than propagating to an uncaught
  exception. Separately (defense in depth, not a substitute for the real
  fix): consider whether `lc worker start`/the process manager should
  auto-restart on unexpected exit at all, matching how a production daemon
  would normally be supervised.

## Phases
- [x] Phase 1: Scope the unscoped stuck-reset (Bug 1)
- [x] Phase 2: Fix the backwards orphan-reconcile mismatch guard (Bug 2)
- [x] Phase 3: Stop static presets from overriding live model discovery (Bug 3)
- [x] Phase 4: Fix the uncaught lock-refresh exception that crashes the whole worker (Bug 4)
- [x] Phase 5: Full regression pass

## Depends on
None — self-contained sync-engine fix.

## Notes
Found via live dogfooding of track 1116's implement dispatch (this same
session) — not a hypothetical. Root-caused to exact file/line locations
before opening this track; plan should verify against current `main`
(this session merged track 1111 to `main` during the same investigation,
which also touches `conductor/laneconductor.sync.mjs` — confirm line
numbers/context still match post-merge before implementing).
**Waiting for reply**: no
