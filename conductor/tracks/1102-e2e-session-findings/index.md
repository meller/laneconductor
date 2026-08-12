# Track 1102: E2E session findings — new project → track → plan flow

**Lane**: plan
**Lane Status**: queue
**Progress**: 20%
**Phase**: Walking the full new-user path in the real UI, fixing what breaks
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

### F2 — "Plan in progress…" is shown for a track that is merely queued 🟠
`TrackCard.jsx:245`:
`nextBtnDisabled = track.lane_status === 'plan' && track.lane_action_status !== 'success'`
so any `plan` track that isn't `success` gets a disabled arrow captioned
*"Plan in progress..."* — including `queue` (nothing running) and
`failed`. Combined with F1 the user sees a permanently disabled button
claiming work is happening when nothing is. Needs to distinguish
queue / running / failed, and say what to do about it.

### F3 — index.md carries both legacy `**Status**` and `**Lane**` markers 🟡
The scaffold template writes `**Status**: plan` near the top; the sync
worker appends `**Lane**: plan` + `**Lane Status**: queue` at the bottom.
Both persist, so a freshly created track has two overlapping状态 markers —
confusing to read and an obvious drift hazard if they diverge. Confirmed
on the newly scaffolded `001-add-a-health-check-endpoint/index.md`.

### F4 — Cloud-mode project selector is dead → filed separately as track 1101
`CloudAppInner` passes `onSelect`, `ProjectSelector` accepts `onChange`.
Split out because it can't be verified in local mode.

### F5 — No UI action can run a lane action on a sync-only project 🔴 CONFIRMED
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

### F7 — A wizard-created project is not a git repo, so every lane action fails 🔴 CONFIRMED
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

### F8 — A failed lane action leaves the dispatch and track stuck forever 🔴 CONFIRMED
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

### F9 — Post-run merge/sync gutted index.md, losing the whole track body 🔴 CONFIRMED
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

### F11 — Spawn timeout killed the dogfooded walkthrough; the FAIL line hid why 🟠 PARTIALLY FIXED
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

**Operational unblock 2026-08-13**: bumped this project's own
`.laneconductor.json` `worker.spawn_timeout_ms` 900000→1800000 (15min→30min)
so the dogfooded 1104 implement run — the one this finding is about —
could be retried and actually complete. This is a config value, not the
structural fix; the per-lane-override / keepalive design question above
is still open for whoever picks it up.


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
- [ ] Phase 2: Fix F2 — accurate lane-action button state/tooltip
- [ ] Phase 3: Fix F3 — one status marker, not two
- [ ] Phase 4: Continue the walkthrough — plan run, Activity, Inbox, deploy wizard (stop before an actual deploy)

## Depends on
[1091](../1091-manager-worker-and-new-project-flow/index.md) (F1 is in its create-project handler), [1084](../1084-worker-identity-and-assignment/index.md) (worker modes).
