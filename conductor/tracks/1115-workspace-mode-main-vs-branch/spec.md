# Spec: Workspace Mode — main-direct vs branch-per-track

## Problem Statement

Every lane action in LaneConductor runs through
`checkAndClaimGitLock` → `createWorktree` → work on a `track-NNN` branch →
merge at `done:success`. There is no other recognized way to do work
(`conductor/laneconductor.sync.mjs:3738-3749`). Three classes of real work
cannot use that path:

1. **Self-hosted infrastructure fixes.** The sync worker, API server and
   Vite UI all run from the primary checkout on `main`. A fix to the worker
   made on a branch does not take effect until merged and restarted from
   main — breaking the fix → restart → verify-live loop that caught most of
   the 2026-08-13/14 session's bugs. You cannot dogfood a fix to the runner
   from a branch the runner is not running.
2. **Live human+assistant pairing.** Sessions commit straight to main with
   no track machinery, so the system has no record connecting those commits
   to the tracks they implemented. This concretely bit track 1113: its
   planning agent correctly verified "Send & Run does not exist" against
   every branch, while the implementation sat uncommitted on main.
3. **Quick bug fixes** where lock + worktree add + branch + merge overhead
   exceeds the change itself.

## Solution

A per-track **workspace mode** with two values — `branch` (today's
behavior, the default) and `main` (run in the primary checkout, no worktree,
no track branch) — resolved by one shared pure function, applied by the
worker at spawn time.

---

## Decisions

### D1 — The unattended-run tension (resolves index.md options a/b/c)

index.md left the crux unresolved: type-based defaulting sends *autonomous*
bug-fix runs to main, but the safety rationale for main mode assumes a human
in the loop. **Resolved as option (b), with one refinement.**

The rule splits on *where the mode came from*, because the two sources carry
different amounts of human intent:

- **A type-derived default is an inference, not a decision.** "This track is
  a bug, so bugs default to main" was never a statement by a human about
  *this* track. When such a track is claimed from the open queue by a worker
  nobody is watching, it runs `branch`. The inference is not strong enough to
  justify an unattended agent committing to main.
- **An explicit `**Workspace**: main` marker is a decision, and it wins —
  including on auto-queue.** This is the refinement, and it deliberately
  diverges from plan.md's Phase 2 Task 1 sub-task as previously written
  ("trigger === 'auto-queue' forces 'branch' even when workspaceMarker ===
  'main'"). Reason: forcing a branch on a track explicitly marked `main`
  does not produce a *safe* run, it produces a **wrong** one — an infra
  track marked main is marked main precisely because a branch run cannot do
  its job (motivation #1: the runner isn't running that branch). Silently
  substituting a run that cannot achieve the track's purpose is worse than
  the bounded risk of the run it asked for. index.md's own default rationale
  supports this: "main-direct is only appropriate with a human in the loop,
  and that's precisely when flipping an explicit switch is cheap" — the
  marker *is* that switch.

**Accepted residual risk, stated plainly:** a track marked `**Workspace**:
main` sitting in the queue can be auto-claimed and run on main unattended,
possibly days after a human set the marker. This is accepted because the
blast radius is bounded on three sides — D10's dirty-checkout guard (the run
refuses to start on a dirty checkout), the git lock (D3 — only one such run
at a time), and REQ-4's track-referencing commits (every commit attributable
and revertable). If this proves wrong in practice, the escalation path is
index.md's option (c): require a track to be human-approved once before an
agent may use main mode. Not built now — it is machinery for a problem not
yet observed.

**Option (d) was considered and not taken.** Track 10018's per-track merge
mode makes a fourth option available: drop bug→main defaulting entirely,
let bug tracks be `branch` + `merge_mode: direct` (fast integration, no PR
ceremony, still quarantined), and reserve main strictly for motivations #1
and #2. This is *simpler and more predictable* than D1 — the mode would
always be explicit, never inferred, and a track's behavior would not depend
on how it was launched. It is not taken now only because 10018 has not
landed and this track should not depend on unlanded work. **If 10018 lands
before this track's Phase 2, option (d) should be reopened** — it would let
D3 be deleted outright, which is a real simplification.

### D2 — Config surface: one marker, not two

Workspace mode is expressed by a single `**Workspace**: main|branch` marker
in the track's `index.md`, parsed the same way `**Type**` already is
(`laneconductor.sync.mjs:1450`). No parallel per-track config file, no
sidecar. This keeps the filesystem-as-API property: a human editing
`index.md` in an editor can change the mode, and the sync worker picks it up
through the existing chokidar path.

Absence of the marker is meaningful and must be preserved as distinct from
`branch`: `parseWorkspaceMarker()` returns `null` when absent or invalid, so
the resolver can tell "unset, fall through to defaults" from "a human chose
branch."

### D3 — Type-derived default: bug → main, feature → branch

When no marker is present, the track's existing `**Type**` supplies the
default. The New Track modal already has this selector (feature vs `⚠ Bug`),
so track creation needs no new UI surface.

Rationale: features are larger and benefit from isolation; bugs are small
fixes where worktree overhead dominates. Per D1 this default only takes
effect for manually-dispatched runs — an auto-claimed bug track still gets a
branch.

### D4 — Project default: `project.workspace_mode`

`.laneconductor.json` gains an optional `project.workspace_mode` accepting
`"main"` or `"branch"`. It sits below the marker and the type-derived
default in precedence, and above the hardcoded `branch` fallback. It is a
sibling of the existing `project.worktree_lifecycle` field and is documented
the same way (see REQ-12) — a manual JSON edit, not a new Config UI section.

### D5 — Resolution order (the authoritative table)

`resolveWorkspaceMode({ laneStatus, workspaceMarker, trackType, trigger,
projectWorkspaceMode })` evaluates in exactly this order, first match wins:

| # | Condition | Result | Source |
|---|-----------|--------|--------|
| 1 | `laneStatus === 'plan'` | `main` | D6 |
| 2 | `workspaceMarker` is `'main'` or `'branch'` | that value | D1, D2 |
| 3 | `trigger` is `'auto-queue'` or `'auto-complete'` | `branch` | D1 |
| 4 | `trackType === 'bug'` | `main` | D3 |
| 5 | `projectWorkspaceMode` is `'main'` or `'branch'` | that value | D4 |
| 6 | otherwise | `branch` | default |

Row 1 before row 2 is deliberate: plan is doc-only for every track, so even
an explicit `**Workspace**: branch` does not buy a plan-time worktree.

Row 2 before row 3 is D1's refinement — the explicit marker outranks the
auto-queue override, while the type-derived default (row 4) does not,
because row 3 sits between them. This ordering is the entire encoding of D1;
getting rows 2/3/4 in this sequence is the single most important detail in
the function.

### D6 — The plan lane always runs main-direct

For every track, regardless of mode, `plan` runs in the primary checkout.
Three reasons, one empirical:

1. Plan only writes the track's own docs (`spec.md`, `plan.md`, `test.md`,
   `index.md`) — nothing needing git isolation.
2. **Direct evidence from this repo:** most of the 44 unmerged branches
   cleaned up in track 1114 were `plan:success, ahead 1-2` doc-only branches
   (1054, 1055, 1070, 1072, 1081, 1094, 1096, …). Plan-in-a-worktree is the
   primary branch-clutter generator; plan-on-main prevents nearly all of it.
3. It resolves a sequencing problem. Today `spawnCli` creates the worktree at
   the *start* of every lane action, plan included — but the classification
   that decides the mode is produced *by* the plan run (REQ-8). The
   classification must exist before any worktree does, and plan-on-main gives
   exactly that.

### D7 — The worktree is created lazily, at first implement

Follows directly from D6. No worktree exists at track creation or at plan
time; the first `branch`-mode lane action (normally `implement`) creates it.
This is a behavior change for every track, not only main-mode ones, and is
the single most likely source of regression — hence REQ-9 and the dedicated
E2E test.

### D8 — `done:success` in main mode needs no merge step

`finishAutoCompleteWithMerge()` (`:4822`) unconditionally calls
`mergeWorktreeBranch()`, which for a main-mode track finds no branch and
returns `{ merged: false, reason: 'no-branch' }` — today reported as a
failure. In main mode the work is *already on main*; "already merged" is the
correct terminal state, so the merge call is skipped and the stage reports
success. This answers index.md's open question: done:success in main mode
needs no merge step at all.

### D9 — Main-mode tracks are absent from the Worktrees panel by construction

Verified against `conductor/services/worktree-audit.mjs:180-215`, not
assumed: `auditWorktrees()` builds its rows from (a) the `git worktree list`
porcelain output and (b) `listTrackBranches()`, i.e. branches matching
`track-*`. A main-mode track creates **neither** a worktree nor a
`track-NNN` branch, so it is never enumerated and produces no row.

This is a stronger guarantee than "`belongsInWorktreesPanel` filters it out."
It specifically means the `stranded` classification — which *does* pass the
panel filter for worktree-less rows — cannot catch a main-mode track, since
`stranded` is only reachable for a branch that exists
(`worktree-audit.mjs:234`). No code change is required for this decision;
REQ-9 exists to lock the behavior with a test rather than to build anything.

### D10 — Dirty-checkout guard for main mode

index.md's open question, resolved: **yes, main mode must refuse to start on
a dirty checkout.** The observed condition that motivates it — this project's
primary checkout routinely carrying 50+ ambient dirty files during a live
session — would otherwise let an agent's `git commit` sweep unrelated human
WIP into a track commit.

- Scope: `git status --porcelain` in the primary checkout, reusing the
  parsing pattern at `conductor/services/git-divergence.mjs:91-93`.
- Disqualifying: any dirty path **outside** the track's own
  `conductor/tracks/{NNN}-*/` folder. The track's own folder is excluded
  because the worker itself dirties it (writing `**Lane Status**: running`
  immediately before spawning, `laneconductor.sync.mjs:4725`) — failing on
  that would make main mode unable to ever start.
- On a disqualifying result: do **not** spawn, leave `lane_action_status:
  queue`, append a `conversation.md` comment naming the offending paths, and
  return **without consuming a retry** — this is a "not now" condition, not a
  failure, and burning retries on it would block the track permanently while
  a human has unrelated files open.

---

## Requirements

- **REQ-1**: A pure `resolveWorkspaceMode()` in
  `conductor/services/workspace-mode.mjs` implements D5's table exactly, with
  no I/O (mirroring `path-isolation.mjs`'s extraction style, so it is unit
  testable and importable without triggering `laneconductor.sync.mjs`'s
  module-load watchers/intervals).
- **REQ-2**: `main` mode still acquires the git lock via
  `checkAndClaimGitLock()`. Only `createWorktree()` is skipped. Main mode
  therefore serializes to one lane action at a time per project — two agents
  editing the same checkout would trample each other, which is precisely what
  the lock exists to prevent.
- **REQ-3**: `spawnCli()` accepts a `trigger` argument, threaded from **all
  four** trigger sources. plan.md previously enumerated three and missed the
  auto-complete chain; the real sites are:

  | Site | Trigger value |
  |------|---------------|
  | `autoLaunchLocalFs()` normal claim (`:4727`) | `'auto-queue'` |
  | `autoLaunchLocalFs()` same call site, `waitingForReply` true (`:4640`) | `'manual-dispatch'` |
  | auto-complete stage runner (`:4814`) | `'auto-complete'` |
  | `checkDispatchInbox()` (`:6022`) | `'manual-dispatch'` |

  Note the first two are the *same* call site — `waitingForReply` is a local
  in that loop (`:4521`), so the trigger is computed inline from it, not
  passed from a separate site.

  `'auto-complete'` is treated as unattended (D5 row 3): it is human-*started*
  but runs a fire-and-forget multi-lane chain, which is exactly the
  "nobody is watching" case D1 guards.
- **REQ-4**: When the resolved mode is `main`, `spawnCli()`'s `contextPrompt`
  gains one instruction line directing the agent to reference the track in
  every commit (`feat(track-NNN): …`, per `conductor/workflow.md`'s existing
  convention), so main history stays attributable — closing the
  "commits with no track record" gap from motivation #2.
- **REQ-5**: `finishAutoCompleteWithMerge()` skips `mergeWorktreeBranch()`
  for main-mode tracks and reports success (D8), rather than surfacing
  `reason: 'no-branch'` as a failure.
- **REQ-6**: `ui/server/utils.mjs`'s `trackTemplates()` emits
  `**Workspace**: main` for the `bug` type and `**Workspace**: branch` for
  `feature`, alongside the existing type line.
- **REQ-7**: `lc new` accepts `--workspace main|branch`, validated against
  that set, writing the marker into the generated `index.md`.
- **REQ-8**: `/laneconductor plan` classifies bug-vs-feature when
  `**Workspace**` is absent, writes the resulting marker to `index.md`, and
  records its reasoning in `conversation.md` as a `> **system**:` comment
  (using the required comment format — plain prose silently fails to sync),
  so a wrong guess is visible and overridable rather than silent.
- **REQ-9**: Main-mode tracks never appear in the Worktrees panel, and the
  lazy-worktree change (D7) does not regress branch-mode tracks. Locked by
  test, not by new code (D9).
- **REQ-10**: Main mode is blocked by the dirty-checkout guard per D10,
  without consuming a retry.
- **REQ-11**: The resolved mode is visible to a human — synced to the DB
  (`tracks.workspace_mode`, alongside how `**Type**` reaches
  `tracks.track_type`, with a migration) and rendered on `TrackCard` /
  `TrackDetailPanel` next to the existing type badge.
- **REQ-12**: `project.workspace_mode` is documented exactly as its sibling
  `project.worktree_lifecycle` is today. No new Config UI section is built
  for it unless one already exists for `worktree_lifecycle`.

## Acceptance Criteria

Each criterion describes an observable outcome, verified by running the
thing — not by reading the diff.

- [ ] A track marked `**Workspace**: main`, dispatched manually, completes a
      full `implement` run in which a human can observe: no
      `.worktrees/{NNN}` directory was created, no `track-{NNN}` branch
      exists, and the agent's commits are present on the primary checkout's
      current branch.
- [ ] A `feature` track completes `plan` with no `track-{NNN}` branch and no
      worktree left behind, then gets a real worktree when `implement`
      starts (D6/D7 — lazy creation observable as a state change between the
      two lanes).
- [ ] A track marked `**Workspace**: main` that is *auto-claimed from the
      queue* still runs on main (D1's refinement), while a `bug`-type track
      with **no** marker that is auto-claimed runs on a branch.
- [ ] With a main-mode track running, a second main-mode dispatch for a
      different track in the same project does not start until the first
      releases the lock (REQ-2 serialization, observed as ordering in the
      worker log, not inferred).
- [ ] A main-mode track reaching `done:success` reports success with no merge
      step, and its conversation shows no `no-branch` failure (REQ-5).
- [ ] With an unrelated file dirty in the primary checkout, a main-mode
      dispatch does not spawn, the track remains at `lane_action_status:
      queue`, its retry count is unchanged, and `conversation.md` names the
      offending path (REQ-10).
- [ ] A main-mode track produces no row in the Worktrees panel at any lane,
      including after `done:success` (REQ-9/D9).
- [ ] Every existing worker E2E test that exercises branch-mode behavior
      still passes unchanged — this track must be byte-for-byte behavior
      preserving for feature tracks, apart from D7's lazy creation.

## Data Model Changes

- `tracks.workspace_mode` — nullable `TEXT`, values `'main'` | `'branch'` |
  `NULL` (unset/unresolved). Requires an Atlas migration. Nullable because a
  track's mode is genuinely unset until a marker, type default, or project
  default resolves it, and because every pre-existing row must remain valid
  without backfill (a `NULL` row resolves to `branch` through D5 row 6 —
  today's behavior).
- `.laneconductor.json` — optional `project.workspace_mode` (D4). No
  migration; absent means "fall through to D5 row 6."

## Non-Goals

- Changing the default for existing tracks. `branch` remains the default
  everywhere D5 does not say otherwise; a project that never sets a marker or
  a project default sees no behavior change except D7's lazy worktree.
- Per-lane workspace modes beyond D6's plan rule. Modes are per-track.
- Any interaction with track 10018's `**Merge Mode**` beyond agreeing on
  sibling marker conventions — main-mode tracks are excluded from 10018's PR
  machinery entirely (no branch → no PR, no preview row, `merge_mode` N/A).
- Claim-time capability matching or human-approval gating (index.md's option
  c) — see D1's escalation path.
