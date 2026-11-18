# Track AM-10141: Stale running claims and human comments mid-run: claim stamp, stale-running lint, warning

**Lane**: review
**Lane Status**: queue
**Progress**: 90%
**Phase**: Implemented and merged to local main 2026-11-18 (461 connector tests): Run Started and Run By stamps on claim, stale_running after 6 hours, human_comment_mid_run warning. Left open: the resting-state lint from workflow.json (needs a decision on which non-terminal successes count as resting), a no-commit-on-branch check. Next: release as 1.2.0.
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: From the audit (findings B2, A5, B5, severity high/medium). Nothing detects a stale `running` claim: there is no owner or time stamp and the summary code says it is not checked (connector/src/summary.mjs). A crashed track-runner leaves `running` forever and the board shows a phantom in flight; otralingo AM-1291 is `running` now. Also, `update_track` marker edits never compare conversation.md, so a human comment added after the run's context was frozen does not stop the lane transition (daemon: services/stuck-track-sweep.mjs, orphaned-dispatch.mjs, commits 88a94ef7 and 02598a15). Resting states (`non-terminal:success`) are not flagged either (services/resting-state.mjs).

Scope: the claim writes `**Run Started**` (ISO) and `**Run By**`; a lint flags `running` older than N hours with no commit on its branch; a release outcome for the human; when Lane or Lane Status change while conversation.md has a human turn newer than the caller's read, warn (or CONFLICT with an `expect_conversation` option); a resting-state lint derived from workflow.json.
**Summary**: From the audit (findings B2, A5, B5, severity high/medium). Nothing detects a stale `running` claim: there is no owner or time stamp and the summary code says it is not checked (connector/src/summary.
