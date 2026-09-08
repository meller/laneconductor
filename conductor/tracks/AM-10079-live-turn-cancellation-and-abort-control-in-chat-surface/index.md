# Track AM-10079: Live turn cancellation and abort control in Chat surface

**Lane**: review
**Merge Mode**: direct
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Implemented — Phases 1-5 built and verified; Phase 6 (remote abort) deliberately deferred, reported as 501
**Type**: dev
**Track Kind**: feature
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Summary**: Implemented. `conductor/services/run-abort.mjs` records abort intent on the run marker and signals the detached process group SIGINT→SIGTERM→SIGKILL behind a pid-reuse guard; the abort endpoint (`POST /api/projects/:id/tracks/:num/abort`) and `lc abort` both call it. The exit handler treats a signalled+intent-marked exit as `abortedByUser`: no retry consumed, no lane transition, parks at `<lane>:waiting` with reason "Cancelled by user". `TurnStatusBar` gained a Stop control wired through `ChatView`. Task 3.7's manager-pseudo-track defect turned out to already be fixed on `main` by an unrelated concurrent track (10067) — re-verified rather than re-fixed. Remote (non-co-located) abort is a stated non-goal, reported as 501.

> [!NOTE]
> **Related to Track AM-10069**: This track implements mid-generation cancellation, which was identified during the coding-agent parity comparison and deferred from AM-10069 (spec.md Decision D1).

## Problem

In standalone terminal coding agents (like Claude Code), a user can interrupt mid-generation by pressing `Ctrl+C`. In LaneConductor, workers spawn headless CLI runs (`stdio: ['ignore', out, out]`). While AM-10069 handles queued interventions for subsequent turns, there is currently no way in the UI to immediately cancel or abort a running turn or lane action if the model runs astray, without killing the worker process.

## Scope

1. **Cancellation API Endpoint**: Add `POST /api/projects/:id/tracks/:num/abort` (and manager equivalent) that reads the target track's live run marker (`conductor/.runs/<track>.json`), signals `SIGTERM`/`SIGINT` to the detached process group (`pgid`), and waits for clean exit.
2. **Process & Lock Cleanup**: Ensure aborting a run releases any active worktree git locks, marks the run marker as finalized/aborted, and avoids leaving corrupted repository states.
3. **UI Cancellation Affordance**: Add a clear "Stop / Abort Turn" button in `TurnStatusBar` and `ChatView` when a run is live.
4. **Conversation & Track State Reconciliation**: Post a cancellation marker turn to `conversation.md` (`> **system**: Turn cancelled by user`) and reconcile `lane_action_status` / `waiting_for_reply`.
**Auto Run**: yes
