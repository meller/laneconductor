# Track AM-10079: Live turn cancellation and abort control in Chat surface

**Lane**: implement
**Merge Mode**: direct
**Lane Status**: running
**Progress**: 100%
**Phase**: Planned — 6 phases (5 implemented, 1 deferred); refined with manager re-dispatch finding
**Type**: dev
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Summary**: Planned. Abort intent is recorded on the existing run marker, the detached process group is signalled SIGINT/SIGTERM/SIGKILL behind a pid-reuse guard, and the exit handler treats the result as a…

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
