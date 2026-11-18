# Spec: Done lane truth: list_tracks and the board stop hiding gated-but-unmerged work

## Problem Statement

From the 2026-11-18 audit of daemon-era fixes versus the plugin (finding B6, severity high). In the plugin world `done:queue` means "gated, not merged", `done:success` means shipped. Today `list_tracks` hides the whole done lane by default (connector/src/tools/list-tracks.mjs:48), so `done:queue`, `done:failure` and `done:waiting` (PR open) vanish; the board's attention rule excludes `done` (connector/src/board.mjs:76); and nothing checks that a track marked done is reachable from the state branch. otralingo's `quality-gate.on_success` is the bare `done`, so its gated tracks land in `done:queue` and disappear.

Scope: default list hides only `done:success`; attention rules for `done:queue`, `done:failure`, `done:waiting`; an optional `merged` check using `git merge-base --is-ancestor` of the track branch; board and tests. Reference: the daemon's services/done-lane-bucket.mjs and resting-state.mjs (tag v1-legacy), tracks 10035 and 10076.

## Follow-up (owner, 2026-11-18): where is the code of a track? (worktree, branch, main, pushed)

Found while looking at the review lane: of the 20 tracks sitting in review or quality-gate, every one has its code already on main and on origin/main (checked with git log on the track number), except 10126 (a private local library, outside this repository). In the old model a track's code lived in its worktree or branch until the merge at the end of the flow (review, quality-gate, then merge to main). In today's practice the runner's branch is merged to main right after implement, so review and quality-gate run on shipped code, and the board cannot tell the difference. The old UI had this view (tracks 10024 worktrees panel, 1112 git sync and worktree visibility, 1115 workspace mode main vs branch, 10076 done-lane grouping from git); the plugin world lacks it.

Add, derived only from git and never stored in the track:
- a `code` field per track in list_tracks, get_track and the board data: `main` (commits naming the track are on the state branch and on its upstream), `main-unpushed` (on the state branch, not on the upstream), `branch` (only on a track or worktree branch, with the branch name), `none` (no commits found: docs-only, or work outside this repository);
- found by: commits on the state branch whose subject names the track number in the usual forms (`track-N`, `AM-N`, `Track N`), excluding state-only connector commits; plus branches and worktrees named for the track; works without a local track branch, which the existing merged check (kept) needs;
- the board card and the detail header show it as a small label; the needs-attention list flags a track in `done` whose code is `branch` or `none`, and a track in review or quality-gate whose code is already `main` as an info line ("already shipped: review and gate are a post-merge check");
- `next` and the lane guides say plainly what review and quality-gate mean when the code is already on main (verify, then done:success) versus on a branch (verify, then merge).

Also write down, in `ops/lanes-and-statuses.md`, which flow the project uses: merge before review (post-merge verification) or merge after the gate; the connector only reports what git shows.

Housekeeping that belongs with this: finished runner worktrees under `.claude/worktrees/agent-*` and old `track-*` branches whose work is merged pile up (17 agent worktrees and dozens of old branches today); a read-only list of them with a prune command shown (never run without a yes).

## Symptom

(To be filled in.)

## Steps to reproduce

(To be filled in.)

## Expected result

(To be filled in.)

## Actual result

(To be filled in.)

## Suspected area

(To be filled in.)

## Environment

(To be filled in.)
