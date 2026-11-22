# Track AM-10141: Stale running claims and human comments mid-run: claim stamp, stale-running lint, warning

**Lane**: done
**Lane Status**: success
**Progress**: 90%
**Phase**: Closed by the owner 2026-11-22 as descoped: the branch-commit check and the resting-state lint were skipped and are not built; they can return as backlog tracks.
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: From the audit (findings B2, A5, B5, severity high/medium). Nothing detects a stale `running` claim: there is no owner or time stamp and the summary code says it is not checked (connector/src/summary.mjs). A crashed track-runner leaves `running` forever and the board shows a phantom in flight; otralingo AM-1291 is `running` now. Also, `update_track` marker edits never compare conversation.md, so a human comment added after the run's context was frozen does not stop the lane transition (daemon: services/stuck-track-sweep.mjs, orphaned-dispatch.mjs, commits 88a94ef7 and 02598a15). Resting states (`non-terminal:success`) are not flagged either (services/resting-state.mjs).

Scope: the claim writes `**Run Started**` (ISO) and `**Run By**`; a lint flags `running` older than N hours with no commit on its branch; a release outcome for the human; when Lane or Lane Status change while conversation.md has a human turn newer than the caller's read, warn (or CONFLICT with an `expect_conversation` option); a resting-state lint derived from workflow.json.
**Summary**: From the audit (findings B2, A5, B5, severity high/medium). Nothing detects a stale `running` claim: there is no owner or time stamp and the summary code says it is not checked (connector/src/summary.
**Part Of**: 10145
**Verdict**: pass
