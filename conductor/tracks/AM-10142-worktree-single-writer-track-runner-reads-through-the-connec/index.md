# Track AM-10142: Worktree single writer: track-runner reads through the connector, code branches never carry track files

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: Parked in the backlog by the owner on 2026-11-18.
**Track Kind**: bug
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: From the audit (findings E1, E2, severity medium). The guides contradict each other: `lanes/implement.md` step 5 tells the agent to tick plan.md and commit in the worktree, while `merge.md` step 3 says "single writer" and the connector guide `implement.md:9` says state belongs on the state branch. The track-runner (`track-runner.md` steps 1-2) reads conversation.md and plan from its worktree copy, which was cut from an earlier HEAD, so human comments added later through the connector are invisible, and it stops when files are missing (seen in this session: planners started in a worktree cut before the track existed). The daemon had a document digest and a bookkeeping-merge helper (services/track-doc-digest.mjs, worktree-artifact-merge.mjs, tracks 10038, 10081).

Scope: one rule in all guides: never commit `conductor/tracks/**` on a code branch, state goes through `update_track` on the state branch; the merge guide pre-checks that `git diff main...track-N -- conductor/tracks` is empty; the track-runner reads the track with `get_track` (primary), not from disk; take-ours guidance for `tracks-summary.md` and the advice log on merge; start worktrees from the current local main. Coordinate with track 10133 (it rewrites the merge lane text).
**Summary**: From the audit (findings E1, E2, severity medium). The guides contradict each other: `lanes/implement.md` step 5 tells the agent to tick plan.md and commit in the worktree, while `merge.md` step 3 say
**Part Of**: 10145
