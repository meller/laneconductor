# Track 1102: E2E session findings — new project → track → plan flow

**Lane**: implement
**Lane Status**: running
**Progress**: 20%
**Phase**: Walking the full new-user path in the real UI, fixing what breaks
**Type**: bug
**Summary**: Umbrella track for bugs found walking the real new-user flow end to end (create project → create track → plan → activity/inbox → deploy wizard). Several are onboarding-fatal: a newly created project's worker is sync-only, so nothing it queues ever runs.

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
