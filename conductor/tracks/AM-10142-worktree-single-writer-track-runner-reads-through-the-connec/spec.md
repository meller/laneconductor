# Spec: Worktree single writer: track-runner reads through the connector, code branches never carry track files

## Problem Statement

From the audit (findings E1, E2, severity medium). The guides contradict each other: `lanes/implement.md` step 5 tells the agent to tick plan.md and commit in the worktree, while `merge.md` step 3 says "single writer" and the connector guide `implement.md:9` says state belongs on the state branch. The track-runner (`track-runner.md` steps 1-2) reads conversation.md and plan from its worktree copy, which was cut from an earlier HEAD, so human comments added later through the connector are invisible, and it stops when files are missing (seen in this session: planners started in a worktree cut before the track existed). The daemon had a document digest and a bookkeeping-merge helper (services/track-doc-digest.mjs, worktree-artifact-merge.mjs, tracks 10038, 10081).

Scope: one rule in all guides: never commit `conductor/tracks/**` on a code branch, state goes through `update_track` on the state branch; the merge guide pre-checks that `git diff main...track-N -- conductor/tracks` is empty; the track-runner reads the track with `get_track` (primary), not from disk; take-ours guidance for `tracks-summary.md` and the advice log on merge; start worktrees from the current local main. Coordinate with track 10133 (it rewrites the merge lane text).

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
