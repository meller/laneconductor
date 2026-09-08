# Spec: Track 10081 — Reconcile track 10067's blocked merge, and stop the unwinnable-merge retry loop

## Problem Statement

Two separate problems share one symptom.

**(A) Track 10067's merge is reported as a 243-file, no-common-ancestor
diff.** That number is an artifact of how it was measured, not a property
of the change. `git diff main track-10067` with no merge base compares two
tips that have drifted apart independently, so every unrelated commit that
landed on `main` since the branch point shows up as part of "10067's diff."
The earlier merge session was right to refuse a blind cherry-pick on that
evidence, but the evidence itself was wrong.

**(B) The track keeps being re-claimed after an honest `done:failure`.**
An unwinnable merge that a session explicitly diagnosed as "needs human
reconciliation" was found back at `done:queue` with
`lane_action_result = 'stuck_timeout'` minutes later, and three different
components reported three different states for the same track at the same
time.

### (A) What the branch actually contains

`main` and `track-10067` genuinely share no common ancestor — different
root commits (`6fd1e94a` vs `55653e98`) from the same history rewrite
behind tracks 008/9997/10011/10050/10066. But `track-10067` still carries
the *pre-rewrite* main history beneath its own work, and the boundary is
explicit and unambiguous: commit `1b164edf`
(`chore(track-10067): sync files before worktree`), the standard marker the
worker writes immediately before creating a worktree. Everything below it
is shared (pre-rewrite) main. Everything above it — 16 commits — is track
10067's own work.

Using `1b164edf` as an explicit merge base changes the picture completely:

| Measured as | Files | Insertions | Deletions |
|---|---|---|---|
| `git diff main track-10067` (no base — what was reported) | 243 | — | — |
| `git diff 1b164edf..track-10067` (true change) | 27 | 3893 | 54 |

The same correction applies to the file that drove the original refusal.
`conductor/laneconductor.sync.mjs` was reported as `+952/-1347`. Its
actual change in 10067's own range is `+362` lines. The rest was main-side
drift the tip-to-tip diff misattributed to this branch.

A three-way merge with `1b164edf` supplied as the base
(`git merge-tree 1b164edf main track-10067`) produces **six conflict hunks
across five files**. Sixteen new files add cleanly. Six shared files
auto-merge cleanly (`bin/systemd-user.mjs`,
`conductor/services/orphaned-dispatch.mjs`, `.claude/skills/laneconductor/SKILL.md`,
`conductor/product.md`, `conductor/tracks/file_sync_queue.md`,
`conductor/tests/track-10046-stale-lane-snapshot.test.mjs`).

The six conflicts, all of them characterized:

| # | File | Nature | Resolution |
|---|---|---|---|
| 1 | `conductor/services/manager-pseudo-track.mjs` | **Real design clash.** Two tracks independently created this filename with completely disjoint APIs. | See below — the only judgment call in the whole reconciliation. |
| 2 | `conductor/laneconductor.sync.mjs` | Same guard, two names: main calls `isManagerPseudoTrack()` (10069), 10067 calls `isReservedPseudoTrackName()`. Identical intent, identical placement. | Keep main's call; drop 10067's duplicate. |
| 3 | `ui/server/index.mjs` | Pure adjacency. 10069 added `GET /api/instance-state` and 10067 adds `GET /manager/workers` at the same line. Not a semantic conflict. | Keep both routes. |
| 4–6 | `TU-10067-.../index.md` (×2), `TU-10067-.../plan.md` (×1) | Track-bookkeeping churn only — `Lane Status`, `Last Run`, `Progress`, a `## ✅ REVIEWED` block. | Bookkeeping-only; the existing `isSafeToAutoResolveBookkeepingConflict` rule already covers this class. |

**Conflict 1 in detail.** `conductor/services/manager-pseudo-track.mjs`
exists on `main` from track **10069** (the manager chat surface) and on
`track-10067` from its own Phase 4 (supervision findings). The two share a
filename and nothing else:

| Version | Exports |
|---|---|
| `main` (10069) | `MANAGER_PSEUDO_TRACK`, `isManagerPseudoTrack`, `shouldAdmitManagerPseudoTrack`, `ensureManagerPseudoTrack` |
| `track-10067` | `MANAGER_PSEUDO_TRACK_NAME`, `isReservedPseudoTrackName`, `pseudoTrackRelDir`, `buildPseudoTrackIndexMd`, `buildPseudoTrackConversationMd`, `formatFindingComment`, `reconcilePostedFindings` |

Neither is a superset. Taking 10067's file wholesale would delete the
manager chat surface that is live on `main` today. Only the first two
exports overlap in meaning (the reserved-name constant and its guard); the
remaining five are genuinely new supervision-finding helpers with no
counterpart on `main`.

### (B) Why an unwinnable merge kept getting retried

`autoLaunchLocalFs` is not the culprit — it skips any track whose
`lane_action_status` is not `queue`, so a track resting at `done:failure`
is never re-claimed. Something else flips `failure` back to `queue`.

Two mechanisms do, and neither consults the retry counter:

1. **`POST /tracks/reset-stuck-actions`** (`ui/server/index.mjs`) resets
   every track whose `lane_action_status = 'running'` and whose
   `last_heartbeat` is older than two minutes to
   `lane_action_status = 'queue'`, `lane_action_result = 'stuck_timeout'`,
   `claimed_by = NULL`. A merge session computing an expensive diff is
   quiet, not dead. The reaper cannot tell those apart.
2. **`findPhantomRunningTracks` / `classifyPhantom`**
   (`conductor/services/stuck-track-sweep.mjs`) reconciles a first-sighting
   phantom straight back to `queue`.

The retry counter that is supposed to bound this never advances. The
`.retry-count` increment lives in the spawn **exit handler**, which is
bypassed when the liveness killer SIGTERMs the process or when the reaper
rewrites the row underneath a still-live session. So
`retryCount >= maxRetries` never becomes true and the loop has no
termination condition.

This also fully explains the three contradictory reports: the dispatch
said `waiting`, `conversation.md` said `failure`, and the database said
`queue`. The reaper and the live session were writing the same row
concurrently, with the DB→disk sync pulling the reaper's value back over
the session's.

## Requirements

### Reconciliation

- **REQ-1**: Land track 10067's work on `main` as a three-way merge with
  `1b164edf` supplied as the explicit merge base. Do not diff tip-to-tip,
  and do not cherry-pick blind.
- **REQ-2**: `conductor/services/manager-pseudo-track.mjs` must retain
  every export `main` has today. Track 10069's manager chat surface must
  keep working unchanged.
- **REQ-3**: Track 10067's five genuinely-new supervision helpers
  (`pseudoTrackRelDir`, `buildPseudoTrackIndexMd`,
  `buildPseudoTrackConversationMd`, `formatFindingComment`,
  `reconcilePostedFindings`) must be reachable by their importers after
  the merge.
- **REQ-4**: `conductor/laneconductor.sync.mjs` must end with exactly one
  reserved-pseudo-track guard at the `syncConversation` site, not two.
- **REQ-5**: `ui/server/index.mjs` must serve both `GET /api/instance-state`
  (10069) and `GET /manager/workers` (10067) after the merge.
- **REQ-6**: Track 10067's own test suite must pass on `main` after the
  merge, together with the pre-existing suite. The 83/83 figure from
  10067's own dispatch is the floor, not the target — the merged tree runs
  both.

### Retry-loop containment

- **REQ-7**: A lane action that ends in `failure` because it is
  *structurally blocked* — a diagnosis that says a human must act — must
  not be returned to `queue` by the stale-heartbeat reaper or the phantom
  sweep.
- **REQ-8**: `POST /tracks/reset-stuck-actions`'s default (non-`immediate`)
  branch must not reset a track that carries a structurally-blocked
  marker, regardless of heartbeat age.
- **REQ-9**: The `.retry-count` increment must survive a SIGTERM'd or
  reaper-clobbered run. A run that is killed by the liveness timeout must
  consume a retry exactly as a run that exits non-zero does.
- **REQ-10**: When the reaper and a live session disagree about a track's
  state, the resolution must be deterministic and observable — the losing
  write is logged, not silently dropped.

### Cleanup

- **REQ-11**: Once 10067's content is confirmed present on `main`, remove
  its worktree (`/home/meller/Code/laneconductor/.worktrees/10067`) and
  delete the `track-10067` branch, matching how 10066 was cleaned up.
- **REQ-12**: Remove the orphaned scratch worktree at
  `/tmp/scratch-merge-10067` left behind by a prior failed merge attempt.

## Acceptance Criteria

Every criterion below is a user-observable outcome. None is satisfied by a
stub or by a log line.

### Reconciliation

- [ ] **AC-1**: `git log main --oneline | grep 'track-10067'` shows 10067's
      Phase 1–7 feature commits reachable from `main`.
- [ ] **AC-2**: `git diff main track-10067 -- conductor/services conductor/tests bin ui`
      reports no differences in 10067's own 27 changed paths, confirming
      the content actually landed rather than a merge commit merely
      existing.
- [ ] **AC-3**: A running manager worker on `main` performs a layer-1
      sweep and writes at least one finding to the supervision
      pseudo-track's `conversation.md`. Observed live, with the written
      file recorded.
- [ ] **AC-4**: The manager chat surface still works on `main` — opening
      the Chat view, selecting the manager target, and sending a message
      produces a reply. Observed in the browser, with a screenshot.
- [ ] **AC-5**: `curl` against a running API server returns a valid
      response from both `GET /api/instance-state` and `GET /manager/workers`.
- [ ] **AC-6**: `node --test conductor/tests/` passes on `main` after the
      merge, including all five of 10067's new test files. Full output
      recorded, not summarized.

### Retry-loop containment

- [ ] **AC-7**: A track parked at `done:failure` with a structurally-blocked
      marker survives at least three full worker poll cycles and one
      `/tracks/reset-stuck-actions` invocation without returning to
      `queue`. Verified by reading the row and the file after the fact.
- [ ] **AC-8**: A track whose run is killed by the liveness timeout has
      its `.retry-count` incremented. Verified by reading the file, not by
      inspecting the code path.
- [ ] **AC-9**: An *ordinary* transient failure still retries normally —
      the containment must not turn every failure into a dead end.
      Verified with a deliberately-failing run that recovers on retry.
- [ ] **AC-10**: A worker log line names the losing writer whenever the
      reaper and a live session contend for the same track row.

### Cleanup

- [ ] **AC-11**: `git worktree list` shows neither `.worktrees/10067` nor
      `/tmp/scratch-merge-10067`.
- [ ] **AC-12**: `git branch --list 'track-10067'` returns nothing, and
      the remote branch is deleted if one exists.

## Design Decisions

**D1 — Explicit merge base over cherry-pick.** `git merge-tree 1b164edf main
track-10067` was run read-only during planning and its output is the
evidence behind every conflict count in this spec. Cherry-picking the
16-commit range would work too, but it replays the same conflicts once per
commit instead of once, and it rewrites 10067's authorship trail for no
benefit. Supplying the base explicitly, via
`git read-tree -m -u 1b164edf main track-10067` followed by
`git merge-index`, resolves the whole branch in one pass.

**D2 — Additive resolution for `manager-pseudo-track.mjs`, never
replacement.** Main's file wins on every symbol it already defines. Track
10067's five new helpers are added alongside, and 10067's
`MANAGER_PSEUDO_TRACK_NAME` / `isReservedPseudoTrackName` become aliases of
main's `MANAGER_PSEUDO_TRACK` / `isManagerPseudoTrack` rather than second
definitions. This keeps 10069's chat surface bit-identical while making
10067's importers resolve. Splitting 10067's helpers into a separate module
was considered and rejected: the two halves genuinely operate on the same
reserved pseudo-track, and a split would leave the reserved-name constant
defined in one file and used from another for no gain.

**D3 — Mark structural blockage on the track, not in the reaper.** REQ-7
could be met by teaching `/tracks/reset-stuck-actions` about merge
specifics, but that puts merge knowledge in a generic reaper. Instead the
lane action that reaches a structurally-blocked conclusion records that
fact on the track itself, and both the reaper and the phantom sweep read
one marker. This generalizes to every other structurally-blocked outcome
without either component learning anything domain-specific.

**D4 — Retry accounting moves ahead of the kill.** REQ-9's fix is to
increment `.retry-count` when the liveness killer fires, not to make the
exit handler more robust. The killer already knows it is ending the run; a
SIGTERM'd process cannot be relied on to run its own bookkeeping.

**D5 — Workspace mode.** Every phase of this track has to run in the
primary checkout. Phase 1 merges another branch into `main`, which is
meaningless inside a track worktree, and Phases 2–3 change the worker and
API server that are serving this project right now — a fix on a branch has
no effect until it is merged and the process restarts. A human should set
`**Workspace**: main` on this track before it leaves the plan lane.
Planning deliberately writes only `**Track Kind**: bug`, which feeds that
default without silently authorizing an unattended run on `main`.

## Non-Goals

- Fixing the underlying history rewrite. Tracks 008/9997/10011/10050/10066
  and now 10067 are all downstream of it. Re-rooting the repository is a
  much larger decision and is not attempted here.
- Track 10070's escalation-dispatch wiring. Track 10067 deliberately
  deferred it; merging 10067 does not close it.
- Track 10067's Phase 7 live checks (7.1/7.3/7.4), which its own plan
  leaves pending deliberate human execution.
- A general-purpose merge-base recovery tool for rewrite-orphaned
  branches. This track uses the branch-point marker by hand; generalizing
  that is a separate effort.
