# Spec: Merge As A Done Lane Action

## Problem Statement

`quality-gate.on_success` currently jumps straight to `done:success` — "success"
is declared before the code ever lands on main. Everything downstream is
compensation for that lie:

- A track can sit "done" for days with its branch unmerged (tracks 1111, 1118,
  1119 — all observed live).
- Merging is handled by **four ad-hoc dispatch handlers** (`merge-worktree`,
  `create-pr`, `merge-pr`, `ai-resolve-conflict`) wired to **two bespoke button
  surfaces** (TrackCard's done-lane actions, WorktreesPanel's six buttons) —
  each its own code path, none producing a transcript, several forgetting to
  post result comments (merge-pr failures were completely invisible until
  2026-08-27's fix).
- The 2026-08-26/27 sessions found five independent bugs in this machinery:
  dead-PID lock trust, INITIALS-prefix folder matching (twice, in two separate
  scans), auto-complete ignoring merge_mode, merge-pr posting no result, and a
  stale DB `merge_mode` clobbering the track file in a loop.
- Status bookkeeping is written to both the branch copy and main's copy of
  `index.md`, generating recurring add/add merge conflicts in the track's own
  metadata.

Meanwhile every *other* lane (plan/implement/review/quality-gate) runs one way:
a worker claims `lane:queue`, spawns the CLI with the laneconductor skill,
produces a live transcript, reports success/failure through the standard
status machinery with retries, model config, and parallel limits. Merging —
the single most consequential action in the pipeline — is the only step that
doesn't.

## Solution

Merging becomes the done lane's standard lane action, run by the same
worker → skill path as every other lane. `done:success` comes to mean
**actually shipped**.

```
quality-gate ──success──▶ done:queue      ← "unmerged", waiting for the merge action
                              │
                    worker claims it (auto-run or ▶)
                              ▼
                         done:running     ← merge skill session, live transcript
                              │
        direct mode ──────────┼────────── pr mode
        merge to main,        │           push branch, gh pr create
        resolve conflicts     │                   │
        in-session            ▼                   ▼
                         done:success        done:waiting  ← card + worktree row show
                              ▲              "PR open → [GitHub link]"
                              │                   │
                              └──── reconciler ───┤ PR merged → success (+ cleanup)
                                                  └ PR conflicted → back to done:queue
```

## Requirements

- **REQ-1**: `lanes.quality-gate.on_success` in `workflow.json` becomes
  `done:queue`. The done lane gets standard lane-action config
  (`primary_model`, `max_retries`, `on_failure: done:failure`).
- **REQ-2**: A new `/laneconductor merge [track]` skill command, claimed and
  spawned through the identical worker claim/spawnCli path as the other four
  lane actions — transcript, retries, per-lane model, parallel_limit, and the
  Auto Run gate all apply unchanged.
- **REQ-3**: The merge action executes **in the primary checkout on main**
  (track 1115's `workspace: main` machinery) — never in the track's own
  worktree. This is the only structural difference from other lane actions.
- **REQ-4**: Direct mode: the session merges `track-N` → main. Real conflicts
  are resolved **in-session** (this replaces the separate `ai-resolve-conflict`
  action). Trivial bookkeeping conflicts keep the existing
  `isSafeToAutoResolveBookkeepingConflict` auto-resolution.
- **REQ-5**: PR mode: the session pushes the branch, opens the PR
  (`gh pr create`), writes the PR markers, and exits with
  `**Lane Status**: waiting`. Within the done lane, `waiting` means exactly
  "waiting on a human outside the system."
- **REQ-6**: The Kanban card AND the Worktrees row for a `done:waiting` track
  must show the PR URL as the completion affordance ("Review & merge on
  GitHub →"). Approval/merge happens on GitHub — there is no Merge PR button
  in our UI.
- **REQ-7**: The PR reconciler keeps polling as today, with two transitions:
  PR merged → `done:success` + cleanup (worktree removed, local branch
  deleted); PR conflicted → back to `done:queue` with a system comment, so the
  merge action re-runs, updates the branch from main, resolves in-session,
  pushes, and returns to `done:waiting`. The loop is closed through the one
  standard path.
- **REQ-8**: Single writer: from `done:queue` onward, only the primary
  checkout's copy of the track files is written. The branch's copy is never
  touched after quality-gate exit.
- **REQ-9**: UI consolidation. Done lane renders the standard status groups —
  queue ("Unmerged"), running (transcript link), waiting ("PR open" + link),
  success, failure — plus the standard ▶ run affordance on `done:queue`.
  DELETE: TrackCard's DoneLaneMergeActions (Merge to main / Create PR /
  Merge PR / AI Resolve) and WorktreesPanel's Merge to main / Create PR /
  Merge PR / AI Resolve / Force Merge buttons. Complete & Merge becomes
  "auto-complete advances lanes and lands at done:queue". Discard and Remove
  Worktree stay (housekeeping, not merges).
- **REQ-10**: DELETE the `merge-worktree`, `create-pr`, `merge-pr`, and
  `ai-resolve-conflict` dispatch handlers and `finishAutoCompleteWithMerge`'s
  merge fork. `openTrackPrOnDone`/`mergeWorktreeBranch` remain as primitives
  the merge action calls.
- **REQ-11**: Migration: a one-time sweep moves every existing `done:success`
  track that still has a live unmerged branch to `done:queue`; plus a one-time
  DB correction of stale `tracks.merge_mode` values that disagree with the
  track file (the 1119 clobber loop). File marker wins.
- **REQ-12**: Creation-time parameters: `lc new` gains `--merge-mode direct|pr`
  and `--auto-run yes|no` flags that write the corresponding markers, so a
  track can declare "direct, auto-runnable" at birth. The newTrack skill
  command documents the same markers.
- **REQ-13**: Any dispatch handler that survives posts its result to
  `conversation.md` through one shared helper — visibility by construction,
  not by each handler remembering.

## Acceptance Criteria

All criteria are user-observable outcomes; none are satisfiable by stubs.

- [ ] AC-1: A direct-mode track passing quality-gate appears in Done under
      "Unmerged (queued)"; after the merge action runs, its commits are
      reachable from local main and the card sits under Success.
- [ ] AC-2: While a merge runs, the card shows `done:running` and the live
      session transcript is reachable from it (same affordance as other lanes).
- [ ] AC-3: A pr-mode track lands at `done:waiting` with a working GitHub PR
      link on both the Kanban card and the Worktrees row.
- [ ] AC-4: Merging that PR on GitHub flips the track to `done:success` within
      one reconcile cycle, removes the worktree, and deletes the local branch.
- [ ] AC-5: If the PR becomes conflicted, the track returns to `done:queue`
      with a system comment; the next merge run updates the branch, resolves
      the conflict, pushes, and the PR becomes mergeable again.
- [ ] AC-6: A direct-mode merge conflict is either resolved in-session or the
      track lands at `done:failure` with the conflict explained in
      conversation.md — never a silent revert to queue.
- [ ] AC-7: The bespoke merge buttons no longer exist in TrackCard or
      WorktreesPanel; only the standard run/transcript/PR-link affordances
      remain.
- [ ] AC-8: `lc new "X" "d" --merge-mode direct --auto-run yes` produces an
      index.md carrying both markers.
- [ ] AC-9: After the migration sweep, no track sits at `done:success` with a
      live unmerged branch, and no DB merge_mode disagrees with its file.

## Out of Scope

- Changing the meaning of `waiting` in any lane other than done.
- The Jira `done` hook (fires on `done:success` as before — now meaning
  shipped, which is more correct, not less).
- Multi-collector/remote-api specifics beyond what the existing dispatch
  machinery already abstracts.
