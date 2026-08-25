# Track 1102: E2E session findings — new project → track → plan flow

**Lane**: implement
**Lane Status**: success
**Progress**: 82%
**Last Run**: mock (primary)
**Phase**: User approved both remaining items — implementing Phase 16 (merge main, 219 commits, re-timestamp, apply F10c to live DB) and Phase 15b (real browser drag gesture)
**Type**: bug
**Summary**: Umbrella track for bugs found walking the real new-user flow end to end (create project → create track → plan → activity/inbox → deploy wizard). Several are onboarding-fatal: a newly created…

## Problem

Everything in this flow had passing unit tests and had been marked done.
Walking it as a user in the real UI (2026-08-12) surfaced a different
picture. This track collects those findings so they're fixed rather than
rediscovered.

## Findings

### F1 — ~~New project's worker is sync-only~~ → NOT A BUG (misdiagnosis, corrected) ⚪
Originally filed as onboarding-fatal: `runCreateProject` spawns
`lc worker start` without `--sync-and-work`, so a new project gets a
`sync-only` worker, and track 001 sat at `plan/queue` doing nothing.

**Corrected**: `sync-only` is the *intended* default. It means "sync +
manual UI operations" — such a worker still serves dispatches
(`checkDispatchInbox` polls every tick regardless of mode; its own comment
says this is "the only way a sync-only worker does anything at all"). What
it deliberately opts out of is the **fully automatic queue-claiming
workflow**. So a newly created project correctly does *not* start burning
tokens on its own; the user drives it from the UI.

The real question this exposed is F5 (below): does the UI's plan action
actually *dispatch*, or does it only set `lane_action_status=queue` and
rely on a queue poller? If the latter, sync-only projects have no working
plan button — which is what the symptom actually was.

Test updated to assert `mode === 'sync-only'` deliberately, so a future
change to `lc worker start`'s default is a conscious decision.

### F2 — "Plan in progress…" is shown for a track that is merely queued 🟠 CONFIRMED & FIXED (unit-tested)
`TrackCard.jsx:245`:
`nextBtnDisabled = track.lane_status === 'plan' && track.lane_action_status !== 'success'`
so any `plan` track that isn't `success` gets a disabled arrow captioned
*"Plan in progress..."* — including `queue` (nothing running) and
`failed`. Combined with F1 the user sees a permanently disabled button
claiming work is happening when nothing is. Needs to distinguish
queue / running / failed, and say what to do about it.

**Fixed 2026-08-15**: the disabled *gating* (`nextBtnDisabled`) was
already correct — a `plan`-lane track genuinely shouldn't advance until
its plan actually succeeds — only the tooltip text was wrong, hardcoding
"Plan in progress..." for every non-`success` state. Added
`nextBtnDisabledReason` (`ui/src/components/TrackCard.jsx`) that
distinguishes `running` ("Plan in progress...") from `failure`/`failed`
("Plan failed — fix and re-run before advancing") from everything else,
i.e. `queue` ("Plan is queued — run it before advancing"). TDD'd:
`ui/src/components/TrackCard.test.jsx` (5 tests — queued/failed/running
tooltip text, arrow enabled+correct-tooltip once succeeded, arrow stays
disabled while queued). 2 of the 5 failed for the right reason (queued/
failed cases got the stale "Plan in progress..." text) before the fix —
the other 3 encoded already-correct behavior (running tooltip, enabled+
correct tooltip on success, disabled-while-queued gating) and passed
immediately, which is expected since only the tooltip text was wrong.
All 5 pass after the fix.

### F3 — index.md carries both legacy `**Status**` and `**Lane**` markers 🟡
The scaffold template writes `**Status**: plan` near the top; the sync
worker appends `**Lane**: plan` + `**Lane Status**: queue` at the bottom.
Both persist, so a freshly created track has two overlapping状态 markers —
confusing to read and an obvious drift hazard if they diverge. Confirmed
on the newly scaffolded `001-add-a-health-check-endpoint/index.md`.

### F4 — Cloud-mode project selector is dead → filed separately as track 1101
`CloudAppInner` passes `onSelect`, `ProjectSelector` accepts `onChange`.
Split out because it can't be verified in local mode.

### F5 — No UI action can run a lane action on a sync-only project 🔴 CONFIRMED & FIXED
This is the real bug behind F1's symptom. Traced end to end:

- Every project created by the New Project wizard gets a **sync-only**
  worker (correct — that's "sync + manual UI operations").
- A sync-only worker never polls the queue. It only acts on the **dispatch
  inbox**.
- But the UI's only "run this lane action" affordance,
  `POST /api/projects/:id/tracks/:num/implement`
  (`ui/server/index.mjs:1384`), just sets `lane_action_status: 'queue'`
  and posts a comment. **It creates no dispatch.** Its own response says
  *"Track moved to waiting state"*.
- So the work only ever happens if a **sync+poll** worker claims it from
  the queue. On a sync-only project nothing ever will.

Worse, that button isn't even reachable for a fresh track: it only renders
when `lane_action_status === 'success'`
(`TrackCard.jsx:440`). A newly created track (`plan`/`queue`) instead
shows a pulsing *"⚡ Plan"* indicator and a disabled next-lane arrow
tooltipped *"Plan in progress..."* — both claiming activity while nothing
runs and nothing can be started.

Net effect: **create project → create track → the track can never be
planned from the UI.** Verified live on project 922 / track 001.

**Proven empirically (2026-08-12)**: dispatching the plan action directly
to the same sync-only worker —
`POST /api/tracks/111732/dispatch {worker_id: 1010, action: "plan"}` —
was claimed within seconds and the track moved to
`plan / running`. So the mechanism is sound and the worker is capable; the
*only* thing missing is the UI creating a dispatch instead of setting a
queue flag. That makes this a narrow wiring fix, not a design problem.

Note for whoever fixes it: `POST /api/tracks/:id/dispatch` takes the
**DB track id**, not the `track_number` (they differ, and `track_number`
is not unique across projects — I got a confusing "action does not match
track's current lane" error from another project's track 001 before
noticing).

Fix direction: manual UI actions must go through the dispatch inbox (the
mechanism that already exists and already works for chat, deploy,
create-project and provision-worker) rather than only setting a queue
flag — plus render a real "run" control for non-`success` states.

### F6 — Worker "mode" is named for the mechanism, not the meaning 🟡
`sync-only` / `sync+poll` describe implementation (does it poll the
queue?) rather than what the user is choosing. The user-facing distinction
is **manual** (syncs + does what I explicitly ask from the UI) vs
**automatic** (also picks up queued work by itself). The current names
leak internals and actively mislead — "sync-only" reads as "does nothing
but sync", which is exactly the wrong inference and is what led to F1's
misdiagnosis.
Proposal: surface these as `manual` / `automatic` in the UI and CLI help,
keeping the existing values as the on-the-wire representation (or migrate
them). Also relevant to `workers.type`, which today is
`project` | `manager` — a separate axis that shouldn't be conflated with
mode.

### F7 — A wizard-created project is not a git repo, so every lane action fails 🔴 CONFIRMED & FIXED
**Fixed** (commit `d0a5dcf`): `runCreateProject()` (`conductor/laneconductor.sync.mjs:4746`,
run by the **manager** worker as part of handling a `create-project`
dispatch) now `git init`s and makes an initial commit when the scaffolded
directory isn't already a repo — narrowly, only when the directory
contains nothing but the scaffold itself; if it finds pre-existing files
it refuses and tells the user to `git init` themselves rather than risk
`git add -A` committing secrets/build output. Covered by
`conductor/tests/track-1091-create-project-worker.test.mjs`. The broader
design question this raised — *should git-init live in the manager's
create-project handler, or the project's own sync worker on first start,
or `lc setup`?* — was deliberately left open and moved to
[1103](../1103-e2e-onboarding-experience/index.md)
rather than answered inline here.
`create-project` scaffolds `conductor/`, `.laneconductor.json`, `.claude/`,
`.agents/` — but never runs `git init`. `spawnCli` takes a git lock and
creates a worktree before every lane action, so the very first plan
attempt died with:

```
[dispatch-plan] Failed to setup lock/worktree for track 001:
Command failed: git worktree add -B "track-001" ".../target/.worktrees/001" HEAD
```

Confirmed: `git rev-parse --is-inside-work-tree` in the new project →
*"fatal: not a git repository"*.

So the New Project wizard produces a project in which **no lane action can
ever run**. Combined with F5, the create→track→plan path is broken at two
independent points.

Fix direction: `runCreateProject` should `git init` when the target isn't
already a repo — **and make an initial commit**. Verified in a scratch
repo, because the distinction matters and is easy to get wrong:

```
$ git init -q && git worktree add -B track-001 .worktrees/001 HEAD
fatal: invalid reference: HEAD          # git init alone is NOT enough
$ git add . && git commit -qm init && git worktree add -B track-001 ...
Preparing worktree (new branch 'track-001')   # works
```

So the scaffolded files must be committed as part of project creation.
For `repo_source.type: 'git'` this is moot (a clone already has history);
it's the `path` / brand-new-project case that's exposed.

### F8 — A failed lane action leaves the dispatch and track stuck forever 🔴 CONFIRMED & FIXED (unit-tested)
When the worktree setup above threw, the worker logged
`[dispatch error]` and moved on — but never reported the failure:

- `worker_dispatch` id 28 stayed **`claimed`** (never `failed`), so nothing
  will retry it and the UI has no error to show.
- `tracks.lane_action_status` stayed **`running`** indefinitely.
- The worker reported **`status: idle`, `current_task: null`** the whole
  time — so the Activity panel shows an idle worker while the board shows
  a running track.

Every other dispatch handler (chat, deploy, create-project,
provision-worker) wraps its work in try/catch and PATCHes
`status: 'failed'` with a real message. The **lane-action path doesn't**,
which is the one users hit most.

Fix direction: the lane-action dispatch branch needs the same
failure-reporting contract as the others — mark the dispatch `failed` with
the error text, reset `lane_action_status`, and clear the busy heartbeat.
This is also why the three states disagreed, which is its own debugging
tax.

**Fixed 2026-08-15**: wrapped the `spawnCli()` call in
`checkDispatchInbox()`'s lane-action branch (`conductor/laneconductor.sync.mjs`,
right after the "Lane action dispatch" comment) in a try/catch matching
the other handlers: on failure it now PATCHes the dispatch `status:
'failed'` with the real error, and reverts both the file's `**Lane
Status**` marker and the DB's `lane_action_status` back to what they were
before the attempt (previously overwritten to `running` right before the
now-caught throw, with nothing to ever put it back). Also fixes a
collateral bug the original write-up didn't call out: since this whole
loop had no per-entry isolation on this branch, an uncaught throw here
used to abort every *other* dispatch still waiting in that same poll
tick, not just the one that failed.

TDD'd in `conductor/tests/track-1102-f8-dispatch-failure-reporting.test.mjs`
against a real spawned worker — reproduced via git-lock contention (a
fresh lock already held by a different machine/pid), not the original
git-repo-with-no-commits trigger, which turns out to now self-heal:
`checkAndClaimGitLock()` commits the track's own files before
`createWorktree()` runs, so a brand-new repo gets its first commit from
that step before `git worktree add ... HEAD` would ever see a missing
ref. 2 tests, watched both fail for the right reason (dispatch stuck
`claimed` past a 20s poll timeout; file left at `Lane Status: running`)
before the fix, then pass after. Confirmed the failure exactly matches
F7's original error family (`git worktree add ... HEAD` / lock
contention), not a different unrelated exception.

**Not done**: the "clear the busy heartbeat" part of the fix direction
doesn't apply as originally worded — traced the code and this branch
never calls `updateWorkerHeartbeat('busy', ...)` in the first place
(unlike every sibling handler), so there's no busy state to clear. That's
a separate, smaller gap (the Activity panel has no way to show "running a
lane action" as busy at all, success or failure) — worth its own
follow-up, not fixed here.

### F9 — Post-run merge/sync gutted index.md, losing the whole track body 🔴 CONFIRMED & PRODUCER FOUND + FIXED (unit-tested)
Caught in the act during the first dogfooded UI-triggered plan run (track
1104, dispatch 29):

- The plan agent, in worktree `.worktrees/1104`, did everything right: its
  copy of `index.md` ended at 4,264 bytes, body fully intact, with
  `Lane Status: success`, `Progress: 100%`, `Last Run: claude/sonnet`.
- After the run, the **main repo's** copy was 263 bytes — four marker
  lines plus a `**Summary**` whose text was lifted from `plan.md`'s
  Phase 1 Problem paragraph. Title, Problem, reference outcome, Meta
  section, Depends-on: all gone. The DB's `index_content` held the same
  263-byte version, and the sync log shows `Track 1104 index.md [PULLED]
  db_newer` twice in the seconds after the run — i.e. the regenerated
  stub won the newer-wins race and was pulled back over the file.
- Control: tracks 1105/1106, which had no run, kept their full bodies. So
  it is the post-run path (worktree merge-back and/or the worker's
  post-run index/DB update), not general sync.
- Markers were also regressed: the agent's `success/100%` became
  `queue/0%` in the gutted version.

**FIXED (guard) 2026-08-12**: `POST /track` now refuses to replace a
substantial `index_content` (>1KB, titled) with one that is both <40% of
its size AND title-less — it keeps the existing body, logs loudly, and
returns `index_guard: 'kept_existing'`. Chosen boundary deliberately: the
forensics showed multiple concurrent pushers (two workers in the main
checkout at different times, plus a phantom test worker heartbeating
pid 999999 from the sibling agent's Playwright fixtures), so guarding the
single endpoint every writer goes through protects against all of them,
including ones not yet written. Deliberate rewrites remain possible —
keep the `# Track` title, or start from no substantial existing version.
4 tests. The *producer* of the stub was not conclusively identified (all
in-repo writers examined — copy-back, Phase 5 marker update, DB pull —
are marker-preserving; suspicion rests on cross-checkout interaction),
so the underlying producer remains open; the guard makes it harmless.

This is the same corruption family as track 1081 (Summary marker
overwrites), now with a precise reproduction: **run any lane action via
dispatch on a worktree-enabled project and diff `index.md` before/after.**
Recovered by copying the worktree's good copy back; the DB then re-synced
from the file (fs newer). Whoever fixes this should start from the
worker's post-dispatch index.md/DB update code and the worktree merge-back
— one of them is regenerating index.md from row fields instead of
preserving file content.

**Producer found and fixed 2026-08-17**: `spawnCli()`'s exit handler
("Phase 5: Update Lane Status in files and commit",
`conductor/laneconductor.sync.mjs`, ~line 3905) READ from
`join(process.cwd(), 'conductor', 'tracks', ...)` — the **primary**
checkout — but WROTE the regex-patched result to
`join(worktreePath || process.cwd(), ...)` — the **worktree** — a few
lines later. By the time a lane action's exit handler runs, the agent's
real work exists only in the worktree; the primary checkout is stale.
Reading primary's stale content, patching only a few `**marker**` lines
into it (Lane/Lane Status/Progress/Last Run — this block never touches
body prose), and writing that hybrid *back into the worktree* silently
clobbered the agent's actual finished work with everything else the
worktree had (Problem, Solution, Meta, etc.) *before* the later
worktree→primary copy-back step ever ran — so copy-back faithfully
propagated the already-clobbered version into primary, with nothing
anywhere logging that it happened. Confirmed live: reproduced with a
real spawned worker, a real git worktree, and a distinguishing marker
written directly into the worktree's `index.md` while the (mocked) CLI
was still "running" — before the fix, the marker was completely gone
from primary's copy after the run; after the fix, it survives intact.

Fix: read from the same location this block writes to
(`worktreePath || process.cwd()`), not unconditionally from
`process.cwd()`. One line. Test:
`conductor/tests/track-1102-f9-index-producer.test.mjs` — watched it
fail (primary ends up with the stale pre-run body, agent's real work
gone) before the fix, pass after. Full conductor suite re-run
afterward: same 6 pre-existing flaky failures as before this change,
no new ones.

The F9 guard from 2026-08-12 stays in place as defense-in-depth (per
this codebase's established pattern of layering a guard *and* fixing
the producer, e.g. F7/F8) — multiple concurrent pushers can still exist,
and the guard protects against any of them, not just this one.

Note: while reproducing this, the primary's copy retained its *own*
pre-run "Solution" paragraph rather than picking up the worktree's
updated one — that's `mergeIndexMarkers()` (the separate copy-back
step, `conductor/services/worktree-artifact-merge.mjs`) deliberately
merging marker *values* from the worktree into primary while preserving
primary's own body prose, not a bug this fix needs to address — F9's
complaint was total body loss (title, every section, gone), which this
fix resolves; which specific body version "wins" when both sides
diverge is `mergeIndexMarkers`'s own, separately-designed behavior.

Also noticed in the same function while fixing this, **not fixed here**
(separate, smaller bug — flagging for its own follow-up): a few lines
below Phase 5's write step, `execSync(... { cwd: workDir })` is called
inside the `if (lastRunLog)` block (~line 4002) referencing `workDir`
before it's declared (`const workDir = ...` is scoped to the *next*,
sibling `if (updated)` block, ~line 4007) — a `ReferenceError` on every
single run that has log output (i.e. nearly always), silently swallowed
by that call's own empty `catch (e) {}`. Net effect: `last_run.log`
never actually gets `git add`ed via this path (the file itself still
gets written to disk first, just never staged here).

### F10 — Worker de-registration destroyed the row, cascading away all chat/dispatch history 🔴 CONFIRMED & FIXED
Observed live during the dogfooded implement run: the worker vanished from
Activity **with its entire chat history**, and dispatches 29/30 disappeared
from the DB mid-run. Full chain, established from evidence:

1. `DELETE /worker` (graceful shutdown) hard-DELETEd the workers row.
2. `worker_dispatch.worker_id` is `ON DELETE CASCADE` → every dispatch —
   including all `worker_adhoc_chat` history the Activity panel shows —
   was erased with it.
3. The row deleted wasn't even the exiting process's own: a short-lived
   second worker had shared the same identity (project 1, meller-X1-AI,
   worker_number 1 — started directly via node, bypassing `lc`'s pidfile
   guard), and its shutdown deleted the row out from under the survivor.
4. The survivor then heartbeated into the void forever:
   `PATCH /worker/heartbeat` returned `ok: true` even at rowCount 0, so
   the "re-register on 404" path never fired — busy and running, but
   invisible in every workers list.

A stable identity (track 1084's whole point) that a routine stop destroys
isn't stable. **Fixed** (TDD, 3 tests):
- `DELETE /worker` → soft de-registration (`status='offline'`, heartbeat
  aged out) — row, id, and all cascaded history survive; re-registration
  reuses the identity via the existing upsert.
- Heartbeat now 404s on rowCount 0 → the worker's existing error handler
  re-registers. Verified live: the orphaned worker (pid 420522)
  re-registered itself within one heartbeat cycle of the API restart.

Still open from this finding: (a) the pre-fix history is unrecoverable;
(b) two processes sharing one identity remains possible when bypassing
`lc` (the pidfile guard) — worth a server-side duplicate-liveness check;
(c) whether `worker_dispatch`'s CASCADE should become SET NULL as
belt-and-braces for manual row deletions.

### F11 — Spawn timeout killed the dogfooded walkthrough; the FAIL line hid why 🟠 CONFIRMED & FIXED (unit-tested)
The 1104 implement run (the walkthrough executing itself) was SIGTERM'd by
the worker's own `spawn_timeout_ms` (15min for this project) mid-Phase-1,
after 90 productive turns — and conversation.md recorded only
`FAIL (exit 143)`, indistinguishable from a real agent failure.

Fixed now (with the 1086 conversation-gap work): the killer sets a flag
and the conversation line reads `exit 143 — killed by spawn timeout after
900s, not an agent failure`, plus the run's closing assistant message is
appended as a proper `> **claude**:` entry (every line `>`-prefixed so the
sync parser accepts it), so the Conversation tab finally carries what the
run actually said.

Still open: 15 minutes is simply too short for walkthrough-class tracks
that drive real browsers and spawn nested runs. Options for whoever picks
this up: per-track or per-lane timeout override in workflow.json, or a
keepalive that extends the deadline while the transcript is still
advancing (the log was growing the whole time — the run wasn't hung,
which is exactly what a timeout is supposed to catch).

**F10's "still open" risk confirmed live, same day (2026-08-13)**: a
plain `make lc-stop && make lc-start` (to pick up the timeout config
change below) failed to kill the running process — `lc-stop` missed it,
`lc-start` spawned a second one, and for ~1 minute **two full worker
processes shared one identity** (project 1, `meller-X1-AI`,
worker_number 1), both writing the same log file, only one able to hold
the DB row at a time. Caught before it raced a real claim (the surviving
one was mid-implement-run on 1104) by manually diffing `ps` against the
single registered row and SIGTERM'ing the redundant one. `lc-stop`'s
inability to reliably find/kill "its" process is the mechanism behind
this entire finding, not a one-off — worth its own investigation
independent of the identity-model question. **Now that investigation: opened
[1110](../1110-worker-separation-and-claim-race-safety/index.md)**, which
also found the more serious sibling bug — the auto-claim path that
decides which track a sync+poll worker runs has NO locking at all
(confirmed from the worker's own code comment: "DB is used only for
heartbeats... not for concurrency control"), so two worker processes
(exactly what this addendum describes) could double-claim and double-run
the same track, not just collide on identity.

**Operational unblock 2026-08-13**: bumped this project's own
`.laneconductor.json` `worker.spawn_timeout_ms` 900000→1800000 (15min→30min)
so the dogfooded 1104 implement run — the one this finding is about —
could be retried and actually complete. This is a config value, not the
structural fix; the per-lane-override / keepalive design question above
is still open for whoever picks it up.

**Structural fix landed 2026-08-19**: went with the keepalive direction
over a per-lane timeout override — a static per-lane number still just
moves the same guessing problem to a different knob, while a keepalive
directly measures the thing that actually matters (is the run still
doing something) instead of guessing how long any given lane *should*
take. `spawnCli()`'s kill timer (`conductor/laneconductor.sync.mjs`) is
no longer a single `setTimeout(timeoutMs)` fired unconditionally after
spawn — it's now a `setInterval` (checked every `timeoutMs/10`, clamped
1-30s) that tracks the spawn log file's size and only kills once it's
seen **no growth for the full `timeoutMs` window**, not merely
"`timeoutMs` since spawn." A run that's still producing output — exactly
the 1104 case, 90 turns, log growing the whole time — now keeps running
for as long as it keeps producing output; a genuinely silent/hung run is
still killed after being quiet for the full window, preserving the
mechanism's actual purpose.

Tested:
`conductor/tests/track-1102-f11-progress-keepalive.test.mjs` — two
real-spawned-worker cases. (1) A mock CLI writing output every 500ms for
7s against a 2.5s configured timeout survives past the original deadline
and finishes successfully — asserted both via the DB's terminal status
*and* directly via the worker's own stdout never containing a kill-log
line, since the killer's `lane_action_result: 'timeout'` tag turned out
to be immediately overwritten by the exit handler's own generic
`error (code N)` PATCH that runs right after it (pre-existing behavior,
unrelated to this fix — found while writing the test, when an assertion
on that DB field alone gave a false negative). (2) A mock CLI producing
no further output for the same 2.5s window is still killed, confirmed
via the new `no log growth for Nms (genuinely stalled)` log line —
proving the real-hang case this mechanism exists for still works.
`mock-cli.mjs` gained a `MOCK_CLI_PROGRESS_INTERVAL_MS` option to
support case (1) (periodic output throughout the delay, instead of one
line then silence). Watched both cases fail for the right reason against
the pre-fix code (case 1's run got killed at the original deadline
despite active output; case 2's kill-log line didn't exist in the old
message format) before the fix, pass after. Full conductor suite re-run:
same pre-existing flaky baseline, no new failures.


### F12 — A successful worktree plan run can still get permanently stuck at `running`, with no UI signal 🔴 CONFIRMED & FIXED (unit-tested)
Found while dogfooding track 1104's UI walkthrough on a fresh project
(`Walkthrough Test Project 1104`, project 925, track 001). This is a
**different** trigger than F7/F8 above — it happens on a project that
**is** a git repo (F7 fixed) and where the "Run plan now" button **does**
create a real dispatch that a sync-only worker claims (so F5's fix is
holding — confirmed live, not just by code reading).

Sequence observed:
1. Clicked "Run plan now" in the track detail drawer. Card correctly
   flipped to a `RUNNING` section with a `WORKER ACTIVE: PROCESSING…`
   badge and a live `stale Ns` counter — this part of the UI works well.
2. The dispatched Claude agent actually ran to completion inside its
   worktree (`.worktrees/001/`): its own Live Transcript panel shows every
   step succeeding and ending with *"Track 001's plan is complete: `spec.md`,
   `plan.md`, and `test.md` have been rewritten… `index.md` is transitioned
   to `**Lane**: plan`, `**Lane Status**: success`… The sync worker will
   pick this up on its next heartbeat and reflect it on the Kanban
   dashboard."* The worktree's `index.md` on disk confirms this:
   `**Lane Status**: success`, real (non-stub) content.
3. That never happened. Hours later: the **main** repo's tracked
   `conductor/tracks/001-.../index.md` (outside `.worktrees/001/`) still
   has the original stub content and `**Lane Status**: queue`. The DB
   agrees: `GET /api/projects/925/tracks` returns
   `lane_action_status: "running"`, `lane_action_result: "stuck_timeout"`
   for track 001 — the two fields disagree with each other (`stuck_timeout`
   normally pairs with resetting `lane_action_status` back to `queue`, per
   `POST /tracks/reset-stuck-actions` in `ui/server/index.mjs:2376`, but
   here it's stuck on `running` instead, suggesting the track got
   re-claimed after one reset and got stuck a second time without ever
   clearing the stale result field).
4. The dispatch queue for the project is now empty (nothing to retry) and
   `GET /api/projects/925/workers` reports the worker `status: "idle"`,
   `current_task: null` — matching F8's exact symptom (Activity panel
   shows an idle worker while the board still shows a running track), but
   from a **different root cause**: not an exception during worktree
   setup, but the worker apparently never running (or never finishing) the
   "copy artifacts from worktree → main repo" step
   (`conductor/laneconductor.sync.mjs:3707` onward) after the spawned
   Claude process exited — despite that process's own transcript showing a
   clean, successful finish.
5. The board card is left showing a permanently escalating `stale Ns`
   indicator (yellow → red) with no explanation, no retry affordance, and
   no link to what actually happened — the real, complete plan output sits
   unreachable in `.worktrees/001/conductor/tracks/001-.../`.

**Net effect**: real completed work can be silently orphaned in a worktree
indefinitely, and the UI's only visible signal is a color-shifting "stale"
timer that never resolves into an actual error state — worse than F8's
case in one respect: here the work genuinely succeeded and is sitting on
disk, but nothing surfaces that or offers a way to recover/merge it.

Fix direction (separate from F8's dispatch-failure-reporting fix): the
worktree copy-back-and-merge step needs to run (or be retried) independent
of whether the parent worker process that spawned the child is still
alive to observe its exit — e.g. reconcile orphaned worktrees with a
`Lane Status: success` marker against their tracked track state on worker
startup/heartbeat, not only in the immediate child-process exit handler.
This track (1104) does not attempt that fix — filing per its Phase 2
scope ("fix anything trivial and local... leave larger fixes referenced
in 1102").

**Filed as F12** (renumbered from the worktree's own "F9" — that slot was already taken in main's committed history by a different, unrelated finding: the gutted-index-content guard. Two independent processes — this dogfooded implement agent working inside `.worktrees/1104`, and my own manual session — each picked "F9" as the next free number without seeing the other's concurrent edit, since the worktree's copy of this file diverged from main the moment the worktree was created. Content preserved exactly as the agent wrote it; only the heading number and this note changed.)

**Directly relevant to [1112](../1112-git-sync-and-worktree-visibility/index.md)**, opened the same day: this finding IS the worktree-merge-back failure 1112 exists to fix, caught in the act rather than inferred from branch-count alone.

**Root-caused and fixed 2026-08-18**, via live reproduction rather than
guessing — two hypotheses tested, one falsified before the real fix:

- **Hypothesis 1 (falsified)**: "the worker-restart-orphans-a-dispatch
  scenario" — already covered by Track 1110 Phase 6's startup
  reconciler (`conductor/services/orphaned-dispatch.mjs`), which post-dates
  this finding. Not F12's actual gap.
- **Hypothesis 2 (falsified)**: "the direct completion PATCH
  (`PATCH /track/:num/action`) fails" — reproduced with a real spawned
  worker + real git worktree, failing only that one endpoint. Did NOT
  reproduce a stuck track: copy-back's own independent `syncTrack()` call
  (a different endpoint, `POST /track`) self-healed it regardless.
- **Hypothesis 3 (confirmed)**: a genuine full outage — every write the
  collector receives failing for a window covering the *entire* exit
  handler (completion PATCH, conversation.md comment sync, copy-back's
  own DB sync, all of it) — reliably reproduced the exact stuck state:
  `lane_action_status` frozen at `running`, `progress_percent: 0`, still
  stuck many reconcile cycles later. The code's own comment at the
  completion-PATCH call site had already predicted this exact gap
  ("DB will show stale state until reconciled" — with no actual
  reconciliation step existing for this specific failure mode).

**Fixed**: `reconcileActiveDispatch()` (`conductor/laneconductor.sync.mjs`,
already polling every 5s for exactly this class of thing — checking
whether an in-flight dispatch's track file shows a terminal status) now
also re-pushes the track's file state to the DB via `syncTrack()`, and —
critically — only removes the track from its `activeDispatch` tracking
map once that push actually succeeds, so a transient outage gets retried
on the next 5s tick instead of being abandoned after one failed attempt.

Caught a real bug in the *first* draft of this exact fix before it ever
committed: `syncTrack()` deliberately catches its own internal
`postToCollectors()` failure and returns the boolean `collectorSynced`
rather than rejecting — the first draft used
`.then(() => true).catch(...)`, which maps *any* resolution (including
one that resolved to `false`) to `true`, silently defeating the retry
logic while looking correct. Only caught because the regression test's
first run passed unexpectedly fast and a `grep` for repeated
`reconcileActiveDispatch` log lines showed only one attempt ever
happened. Fixed by using the returned value directly.

Tested: `conductor/tests/track-1102-f12-stuck-running.test.mjs`, against
a real spawned worker and real git worktree, using a new test-only
failure-injection endpoint added to `conductor/tests/mock-collector.mjs`
(`/_set-fail-all-writes`, time-window-based rather than a request-count
budget — a count-based budget was tried first and proved unreliable,
since unrelated background traffic like file-sync polling shares the
same pool and can consume it before the exit handler's own calls ever
arrive). Watched it fail (never recovers, even 15s+ after the outage
clears) before the fix, pass after. Full conductor suite re-run: 7
pre-existing flaky failures both before and after (same set, confirmed
via stash-compare), no new failures.

### F13 — A manager co-located with a project shares (and clobbers) that project's auth token 🔴 CONFIRMED & FIXED
Caught live while dogfooding track 1112's own dispatch: `GET
/api/projects/1/workers` showed the project worker's `pid` field flapping
every ~10s between the real worker's pid and the **manager's** pid,
even though the manager process was demonstrably healthy and its own
heartbeat body correctly declared `project_id: null` every single time
(verified directly against its `.manager.log`).

Root cause, traced precisely: `resolveCollectorToken()`
(`conductor/laneconductor.sync.mjs:706`) falls through to
`collectors[0].machine_token` — read from **whatever
`.laneconductor.json` is in the current working directory**. A manager
worker started from a directory that is *also* a real project (this
project's own dogfooding setup, and plausibly common for anyone running
`lc worker start --manager` from inside a project they also work on) has
**no credential storage of its own** — it authenticates its heartbeats
using that co-located project's own `machine_token`. The server's
`collectorAuth` then resolves `req.worker_project_id` from *that token's
owning row* (the project worker's, `project_id: 1`) — and the heartbeat
handler's old precedence, `req.worker_project_id || body.project_id`, let
that auth-derived value silently win over the manager's own correct
`project_id: null`, so every manager heartbeat overwrote the **project
worker's** row with the manager's own `pid`.

**Fixed**: the handler now trusts an explicit `project_id` in the request
body (including an explicit `null`) over the auth-derived value —
`'project_id' in req.body ? ... : req.worker_project_id` — falling back
to the auth-derived value only when the body says nothing at all (the
common, legitimate case). 3 tests, verified live: pid stayed stable
across 4 consecutive 10s heartbeat cycles post-fix, no more flapping.

**Left open**: the deeper cause — a manager has no credential storage
separate from a co-located project's `.laneconductor.json` — is not
fixed, only its most damaging symptom. A manager should plausibly persist
its own `machine_token` in `~/.laneconductor/manager-config.json`
(alongside the existing `projectsDir` setting) rather than ever reading
`collectors[].machine_token` from whatever directory it happens to be
started in. Worth its own track.

### F14 — The Logs tab is silently empty for every Claude-cli run, by design nobody documented in the UI 🟡 CONFIRMED & FIXED (UX only)
Noticed live: track 1112's Transcript tab showed the live implement run
in full; its Logs tab was empty, with no explanation. Confirmed in code
— `spawnCli`'s raw-text tail interval is explicitly disabled for Claude
(`tailInterval = cli === 'claude' ? null : setInterval(...)`,
`conductor/laneconductor.sync.mjs:3523`), because track 1087 moved
Claude's live output to the structured stream-json feed the Transcript
tab reads instead. `last_log_tail` (what the Logs tab renders) is simply
never populated for Claude runs — correct by design, but the empty state
read identically to "nothing has run yet," which is what prompted the
question.

**Fixed (UX only, not the underlying data)**: the empty state now says
explicitly, for Claude runs, that the live output is on the Transcript
tab instead. Backfilling `last_log_tail` itself (e.g. from the completed
transcript) was considered and deferred — the Transcript tab already
serves that need better than a raw tail would for Claude specifically;
non-Claude CLIs are unaffected (still populate `last_log_tail` normally).

### F15 — F5's dispatch bridge only covers `/implement`; drag-to-lane and reset still strand sync-only projects 🔴 CONFIRMED & FIXED (unit-tested, not live E2E)
Found 2026-08-15 while diagnosing why track 10011 sat at `lane_action_status:
'queue'` indefinitely after being dragged to the Implement lane (root cause
of *that* specific incident turned out to be unrelated — the real
implementation was sitting on an unmerged branch — but reading the dispatch
path to rule it out surfaced this separate, real gap).

- F5's fix (confirmed in code) lives entirely inside
  `POST /api/projects/:id/tracks/:num/implement` (`ui/server/index.mjs:1514`):
  when a project's only live workers are `sync-only`, it inserts a
  `worker_dispatch` row addressed to one of them instead of only setting
  `lane_action_status: 'queue'`.
- `PATCH /track/:num/lane` (`ui/server/index.mjs:2846`) — the endpoint the
  Kanban board's drag-and-drop and `handleLaneChange` confirm dialog both
  call via `PATCH /api/projects/:id/tracks/:num` — has no such bridge. It
  only sets `lane_action_status = 'queue'`.
- `PATCH /track/:num/reset` (`ui/server/index.mjs:2894`, used by "fix review
  gaps" / update flows) has the same gap.
- Net effect: on a sync-only project (the default per F5/F6), dragging a
  card to a new lane — or any flow that calls `/reset` — sets the queue
  flag and then nothing ever claims it, identical to F5's original symptom,
  just via a different entry point that F5's fix didn't cover.

**Fixed 2026-08-15**: extracted F5's bridge logic into a shared
`dispatchIfSyncOnly(projectId, trackNumber)` helper (`ui/server/index.mjs`,
right above the `/implement` route) and call it from all three sites:
`/implement` (unchanged behavior, now via the shared helper),
`/track/:num/lane` (only when the lane change results in
`lane_action_status: 'queue'` — a move to `done` sets `'success'` instead,
nothing to dispatch), and `/track/:num/reset`. TDD'd against the existing
F5 test pattern: `ui/server/tests/track-1102-f15-lane-reset-dispatch.test.mjs`
(5 tests — dispatches when all live workers are sync-only, does not
dispatch when a sync+poll worker exists, does not dispatch on a move to
`done`). Watched all 5 fail for the right reason (no `worker_dispatch`
insert) before restoring the production code, then watched them pass.

**Not proven live** the way F5 was (no real drag-and-drop against a real
sync-only project, watching a `worker_dispatch` row appear and get
claimed) — confirmed via unit tests exercising the same code path F5's
tests already trust, not a live E2E walkthrough. Worth a live pass if this
resurfaces.

### F16 — Worker identity lock silently stopped protecting against duplicates when cwd wasn't the primary checkout 🔴 CONFIRMED & FIXED
Found live (2026-08-17) chasing a "can't delete worktree from the UI"
report: 4 separate `node conductor/laneconductor.sync.mjs --sync-only`
processes were running simultaneously, all under the same default
identity (project 1, no `--worker-number`), none matching the tracked
`.sync.pid`. Same failure family as F10/F11 — but this time the
exclusivity lock built in [1110](../1110-worker-separation-and-claim-race-safety/index.md)
Phase 2 (`conductor/services/worker-lock.mjs`, acquired at
`laneconductor.sync.mjs` startup) was already in place and *should* have
made this impossible.

Root cause: the lock's own path was computed as
`join(process.cwd(), 'conductor', '.sync.lock-target')`
(`laneconductor.sync.mjs`, right before `acquireWorkerLock()` is called).
Exact same bug class as the nested-worktree issue fixed earlier the same
day in `createWorktree()`/`removeWorktree()` — a worker process spawned
with cwd anywhere other than the primary checkout (a linked worktree, a
stale cwd from whatever spawned it) computes a *different* lock path than
a "normal" worker for the identical identity, so the two never actually
contend for the same lock file. The mkdir-based exclusivity is real and
correct; it just wasn't being asked to guard the same resource every
time.

**Fixed**: lock path now resolves through `resolvePrimaryRepoRoot(process.cwd())`
(the same primitive `createWorktree`/`removeWorktree` already use) before
joining `conductor/.sync*.lock-target`, so every process meant to hold one
identity's lock computes the identical path regardless of its own cwd.
Manager lock path (`~/.laneconductor/manager.lock-target`) was already
cwd-independent, unaffected.

**Verified live**: killed all 4 duplicate processes, cleared the stale
pidfile, restarted a single worker — confirmed exactly one process running
under the default identity afterward. Not yet verified under the specific
repro condition (deliberately starting a worker from inside a linked
worktree and confirming it now refuses to start a duplicate) — worth doing
if this resurfaces.

### F17 — `lc worker start`/`restart` can spawn a worker pointed at a linked worktree's own stale copy of the sync script 🔴 CONFIRMED & FIXED (live-verified)
Found live (2026-08-18) while restarting workers to pick up Phase 18
changes: two of the running processes were executing
`.worktrees/1111/conductor/laneconductor.sync.mjs` and
`.worktrees/10018/conductor/laneconductor.sync.mjs` — old, worktree-local
copies of the sync script, not the primary checkout's. `.worktrees/1111`
is 143 commits behind main, so that process was running code from long
before today's F16 fix (and everything since) — including a pre-fix
worker-lock path computation, meaning it could sit as an undetected
duplicate identity indefinitely. Neither process was even visible in
`GET /api/workers` (same "registration silently never resolves" shape as
F8/1084 Phase 8).

Root cause: `resolveSyncScript(projectRoot)` (`bin/lc.mjs:254`) joins
`projectRoot` + `conductor/laneconductor.sync.mjs` directly, and
`projectRoot` itself comes from `findProjectRoot(process.cwd())` — a
walk-up that stops at the first directory containing a `conductor/` dir,
which a linked worktree satisfies just as well as the primary checkout
(same class of ambiguity `mergeWorktreeBranch()`'s own doc comment
already calls out). Running `lc worker start`/`restart` with cwd inside a
worktree spawns the worker with `cwd: projectRoot` = that worktree, and
loads *that worktree's own* (possibly very stale) copy of the script.

**Fixed (2026-08-18, same day, after the bug bit for real)**: user reported
"so many detached [worktrees] are still appearing" a few hours later — the
nested `.worktrees/1111/.worktrees/9998,9999` shape from F16's original
fix had come back, created at 11:35 that morning by exactly this stale
process. Deliberately did NOT touch `findProjectRoot()`/`projectRoot`
globally (used throughout `lc.mjs` for many other commands, several of
which may legitimately want the worktree-local directory) — instead
resolved a scoped `workerRoot = resolvePrimaryRepoRoot(projectRoot)`
right after each command's own `!projectRoot` guard, and used it for
*every* artifact that command touches (pidfile, logfile, `resolveSyncScript()`,
the spawned process's own `cwd`): `start`, `restart`, `stop`, `worker run`,
and `worker status` — the last two found while fixing the first three,
same class of bug (`worker status` queried from a worktree would look for
the pidfile in the wrong place and misreport a live worker as stopped).

**Live-verified against the exact real trigger**: ran `lc start
--worker-number 199` from inside `.worktrees/1111` itself — confirmed via
`ps` the spawned process executes the **primary** checkout's
`conductor/laneconductor.sync.mjs`, with its pidfile/lockfile/logfile all
correctly anchored under primary too (not the worktree). `lc worker status`
queried from the worktree and `lc stop` run from primary both correctly
found and controlled the same process. Cleaned up the leftover nested
worktrees and throwaway test artifacts afterward.

### F18 — A phantom test worker (pid 999999) absorbs real dispatches, which then sit pending forever 🔴 CONFIRMED & FIXED (unit-tested)
Hit live (2026-08-18) dispatching track 10019's plan through the UI:
the dispatch was created correctly but sat `pending` past every polling
window. `worker_dispatch.worker_id` pointed at worker **1013 — pid
999999, worker_number 99** — the Playwright fixture worker F9's
forensics already identified ("a phantom test worker heartbeating pid
999999 from the sibling agent's Playwright fixtures"). Some test run was
actively heartbeating it at that moment (last_heartbeat seconds old), so
the dispatch route's "any live worker for the project" fallback
(`ui/server/index.mjs`, the same resolution added in 1112 D7/1114)
selected it — `ORDER BY id LIMIT 1` picks the LOWEST worker id among
live ones, and the phantom (id 1013) beats every real worker (1112,
1259). A phantom heartbeats but never polls a dispatch inbox → the
dispatch starves silently, no error anywhere. Unblocked manually
(`UPDATE worker_dispatch SET worker_id=<real>`).

Fix directions (pick at least one):
- Make Playwright fixtures unmistakable: register test workers with a
  reserved marker the dispatch resolver excludes (e.g. `mode: 'test'`,
  or visibility flag) instead of looking identical to real workers.
- Same-host pid liveness check in the fallback query — pid 999999 never
  exists; the server can't check remote hosts but CAN skip workers whose
  claimed pid is dead on its own host.
- A claim-timeout: a dispatch still `pending` after N minutes gets
  reassigned to another live worker (also covers real workers dying
  post-assignment — a gap independent of phantoms).

**Fixed 2026-08-18**: went with a targeted variant of the first
direction rather than repurposing `mode` (already has real,
worker-behavior semantics — sync-only vs sync+poll — overloading it for
"is this fake" risked breaking that) or same-host pid liveness (unsafe
in general: a remote-api worker's pid legitimately doesn't exist on the
collector server's host, so a blanket liveness check would wrongly
exclude every real remote worker). Instead, excluded the two concrete,
already-established fixture signatures this codebase's own Playwright
specs use — pid `0` (`track-1033-e2e.spec.js`; never a real process,
reserved for the kernel scheduler on Linux) and hostname prefix
`pw-e2e-` (`worker-identity.spec.js`, pid 999999) — from every "any live
worker for this project" fallback query. Found and fixed **three** call
sites sharing the identical unguarded pattern, not just the one this
finding named: `POST /api/projects/:id/dispatch`'s fallback,
`POST /api/projects/:id/worktrees/refresh`'s fallback (both
`ui/server/index.mjs`), and `dispatchIfSyncOnly()` — F5/F8/F15's own
sync-only dispatch bridge, which had the same gap via an *unordered*
`projectWorkers[0]` (now `ORDER BY w.id ASC` explicitly, plus the same
exclusion). A claim-timeout (this finding's third direction) is still
worth doing independently — it also covers a *real* worker dying
mid-flight, which exclusion-by-signature can't — tracked as a possible
follow-up, not implemented here.

Tested: `ui/server/tests/track-1102-f18-phantom-worker.test.mjs` — 3
tests against a mocked pool that only filters candidates when the real
SQL text sent by the app actually contains the exclusion clause (so a
future regression that drops the filter fails these tests, not just a
dedicated SQL-string check). Watched all 3 fail for the right reason
(phantom id 1013 wins over real id 1259) against the pre-fix code,
pass after. `track-1102-f5-ui-dispatch.test.mjs` (dispatchIfSyncOnly's
own existing suite) re-run alongside — still 4/4. Full `ui/server`
suite re-run: 7 files / 20 tests failing both before and after this
change (confirmed via stash-compare, not just eyeballing) — all
pre-existing/unrelated (mostly an in-progress track 1116 test expecting
an export that hasn't landed yet).

### F19 — The only one-click path out of Backlog skips the Plan lane entirely 🟡 CONFIRMED & FIXED (unit-tested)
Hit live dispatching track 10019: the backlog card's `→` arrow (titled
"Move this card to the Start lane") moved it straight to **implement** —
`NEXT_LANE = { backlog: 'implement', ... }` in
`ui/src/components/TrackCard.jsx:14`, with implement literally labeled
"Start". Combined with F15's bridge, one click dispatched a real
implement agent against a track with **no plan.md/spec.md/test.md at
all** (caught by the user: "it means we didn't plan with laneconductor
skill"; the run was killed and re-routed through plan by hand-editing
the lane marker — there is no UI affordance to move backlog → plan).
Either backlog's next lane should be plan, or the arrow should offer a
choice, or at minimum moving to implement with no plan artifacts should
warn.

### F20 — A dead run's transcript strip overlays the card's own action buttons and silently swallows clicks 🟠 CONFIRMED (not fixed)
Hit live: after killing track 10019's implement agent, its stale
transcript strip stayed rendered under the card — and
`document.elementFromPoint` confirmed it sat ON TOP of the card's "Run
plan action" button. Two real clicks landed on the transcript div and
did nothing: no POST, no error, no feedback — the same "clicking does
nothing" presentation as 1114's window.confirm bug and F18 above, each
with a completely different cause. Collapsing the transcript freed the
button. Layering/layout bug in the board card + transcript strip
(`TrackCard`/`TranscriptView`); also worth asking why a finished (killed)
run's transcript still renders as if live.

### F21 — An implement agent that backgrounds a long command at turn end exits 0 mid-work; the run silently resets to queue with everything uncommitted 🟠 PARTIALLY FIXED (escalated variant fixed & unit-tested; original turn-end variant still open)
Hit live on track 10019's implement run (dispatch 1516, 2026-08-18): the
agent finished Phases 1-2 worth of real work (new
`conductor/services/primary-cwd.mjs`, a new 19-test suite it had watched
pass, fixes across `laneconductor.sync.mjs`/`bin/lc.mjs`/
`worktree-audit.mjs`), then launched the full conductor regression suite
as a **background task** — and the `claude -p` session terminated right
there. Process exit 0, so the exit handler treated it as a clean end;
the worktree's `index.md` still said `implement: running / 0%`, so the
handler could call it neither success nor failure and reset
`lane_action_status` to `queue`. All the work sat uncommitted in the
worktree; the board showed a quietly re-queued implement with no signal
anything had happened. The transcript's literal last event is
`task_started: "Run full conductor test suite"` followed by nothing.

Recoverable by design (worktree lifecycle reuses the directory; session
continuity resumes the same conversation), so a re-run continues where
it left off — but nothing *tells* anyone that's needed.

Fix directions:
- Exit handler: exit 0 + index still at `running` + dirty worktree is a
  distinguishable state — surface it as its own outcome ("ended
  mid-work, re-run to resume") in the dispatch result/conversation.md
  instead of the generic queue reset.
- Prompt/SKILL guidance: lane agents should not END their final turn on
  a just-launched background command — either wait for it or run it
  foreground; the harness kills background children when the session
  process exits.

**Escalated 2026-08-19 — worse and systematic, not a turn-end anomaly.**
Both the review AND quality-gate runs on the same track showed a more
serious variant: the dispatch row was marked `done` (with the generic
"lane status: queue" result) and the DB lane reset to `queue` **while
the spawned agent was still alive and actively working** — confirmed
both times by finding the live `claude` process (with its Playwright MCP
session) still running inside `.worktrees/10019`, git lock legitimately
held, minutes after the dispatch had already been closed out. Fallout
chain observed live: the premature `queue` made the UI offer "Run
review" again → clicking it created a second dispatch → the second
dispatch failed on the (correctly held) git lock with "Track locked by
…" — which reads like an error but is actually the only thing that
PREVENTED a duplicate concurrent review. So the lock layer is sound;
the dispatch/exit bookkeeping is closing runs it should still be
watching. Whoever picks this up should start from what marks a
lane-action dispatch `done` + resets lane status *while the child
process it spawned is still alive* — likely the same early-close path
in both observations (reconcile logic or a mis-attributed exit event),
NOT the agent's own behavior (unlike the original F21 case above, these
agents were mid-flight and healthy).

**Root cause found & fixed 2026-08-20 (escalated variant only).** Traced to
`syncWorktreeDocsToPrimary()` (`conductor/laneconductor.sync.mjs`, added by
track 10019 Phase 4) — it runs every 60s for every live worktree,
deliberately including actively-locked ones, and merges the worktree's own
`index.md` markers (Lane/Lane Status included, per track 1112's fix) onto
primary's copy via `copyWorktreeArtifactsToPrimary()` →
`mergeIndexMarkers()`. For a **reused** per-cycle worktree (the normal case
for a track's 2nd+ lane action — review, then quality-gate, both against the
same worktree, exactly track 10019's shape), the worktree's Lane/Lane Status
stays frozen at whatever the *previous* cycle's exit handler last wrote
until *this* cycle's own exit handler runs — nothing updates it mid-run.
`copyWorktreeArtifactsToPrimary`'s `skipUnchanged` staleness guard (mtime
comparison) normally protects against syncing a stale worktree file, but any
ordinary mid-run edit an agent makes to its own `index.md` — e.g. bumping
`**Progress**`, which agents routinely do and which never touches `**Lane
Status**` — bumps the worktree file's mtime past the guard, letting the
merge through and carrying the still-stale Lane Status along with it. That
clobbers the "running" marker `checkDispatchInbox()` had just written onto
primary, and the very next `reconcileActiveDispatch()` tick (5s cadence)
sees a non-"running" status and closes the dispatch as done — while the real
agent process is still alive. Reproduced live end-to-end (real git
worktree, real dispatch lifecycle, simulated one ordinary mid-run Progress
edit) in
`conductor/tests/track-1102-f21-mid-run-doc-sync-clobber.test.mjs`: RED
against the unfixed code (dispatch closed out mid-run), GREEN after the fix
(dispatch stays `claimed` through several doc-sync ticks, then completes
normally once the run actually finishes).

Fix: `mergeIndexMarkers()`/`copyWorktreeArtifactsToPrimary()` gained an
opt-in `skipStatusMarkers` option (default `false` — every existing caller,
i.e. the exit handler and orphan-reconcile, is unaffected) that excludes
Lane/Lane Status from what gets merged. `syncWorktreeDocsToPrimary()` now
passes `skipStatusMarkers: true` — mid-run syncs still keep Progress/Phase/
Summary/Waiting-for-reply live (the whole point of that pass), just without
the one marker whose staleness has a completion-detection side effect.
Also added `LC_DOC_SYNC_INTERVAL_MS` (test-only override, default stays
60s) so this is testable without a real 60s wait, matching the existing
`LC_DISPATCH_POLL_MS`/`LC_WORKER_ID_WATCHDOG_MS` pattern. 8 unit tests in
`conductor/tests/track-1112-worktree-artifact-merge.test.mjs` cover the new
option directly (2 new, 6 pre-existing all still pass unmodified).

**Still open:** the *original* (non-escalated) F21 case above — an agent
that itself backgrounds a long command and lets its own turn end mid-work —
is a different mechanism (the exit handler sees a clean `exit 0` against a
still-`running` index.md and generically resets to `queue`) and needs its
own fix per the "Fix directions" above (a distinguishable "ended mid-work"
outcome, plus SKILL guidance against backgrounding a final-turn command).

## What worked (verified live, not assumed)

- New Project wizard → real scaffold run → project registered + worker
  started. All 9 context files generated, **including `quality-gate.md`**
  with unchecked boxes and `Status: PENDING` (the track-1084 fix behaving
  correctly on a real run), and it honestly reported "no tooling detected"
  instead of inventing commands.
- New Track modal → track 001 created, synced to disk, all 5 files
  scaffolded including a populated `test.md` (track 1095's fix holding).
- Worker chat (track 1087 Phase 8): real reply round-trip.
- Per-worker Stop (track 1084 Phase 6): stopped one worker, manager
  untouched.

## Phases
- [ ] Phase 1: Fix F1 — decide and implement the worker mode a newly created project should get
- [x] Phase 2: Fix F2 — accurate lane-action button state/tooltip (fixed, unit-tested)
- [ ] Phase 3: Fix F3 — one status marker, not two
- [ ] Phase 4: Continue the walkthrough — plan run, Activity, Inbox, deploy wizard (stop before an actual deploy)
- [x] Phase 5: Fix F15 — extend F5's sync-only dispatch bridge to `/track/:num/lane` and `/track/:num/reset` (fixed, unit-tested; live E2E verification still open)
- [x] Phase 6: Fix F16 — worker identity lock path now resolves the primary checkout instead of trusting cwd directly; fixed and live-verified (killed 4 real duplicate processes, confirmed exactly one survives a clean restart)

## Depends on
[1091](../1091-manager-worker-and-new-project-flow/index.md) (F1 is in its create-project handler), [1084](../1084-worker-identity-and-assignment/index.md) (worker modes).
**Waiting for reply**: no
