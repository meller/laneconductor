# Spec: Board page follow-ups (AM-10151)

Moved from track 10115 on 2026-11-19 (its plan tasks Phase 2 task 8, Phase 3 tasks 1 to 3, Phase 5 tasks 5 to 7).

## Requirements

- REQ-1 Verify, in the Claude desktop app with the parallel add-on running, that the board page reaches the connector as the host server `host:plugin_laneconductor-parallel_lc`: the Move menu changes a track's lane through `update_track` with a confirm step and shows a CONFLICT clearly, and "Check now" compares the board's commit with the repository. If the server string is wrong, fix it; if the page cannot reach the connector at all, remove the controls instead of leaving them.
- REQ-2 Look at the board by hand at 375 px width and in the light and dark themes: the Project drawer, the What's next panel, the freshness chip, the Move menu and the new "newer board" button.
- REQ-3 The Review-the-plan button in a track's detail view (the `sample` capability): a fixed instruction, the plan and spec text only when the privacy scan did not withhold them, a note that it is a separate Claude call that changes nothing; hidden when consent is not granted. Build it only if the owner wants it.
- REQ-4 By hand, on a scratch repository: `/laneconductor:status`, `:plan` and `:run`; confirm the subagent recommendation and that nothing starts unasked.

- REQ-5 The board add-on's Stop hook notices a change of the tracks by any tool, not only Edit and Write (owner, 2026-11-20: "was expecting the hook to work"): it compares a fingerprint of the tracks (the tree of `conductor/tracks` on the state branch, plus the uncommitted changes under it) with the one seen at its last prompt, so a Bash edit, a scratch worktree, another session or a push marks the board stale. The first Stop only records the fingerprint; `board.auto_update: false` and a missing board stay silent; the only child process is a read-only `git` (rev-parse, status). Built as board 1.10.4.
- REQ-6 In a track's drawer, each track it depends on or waits on is a button that opens that track ("Blocked by", and "Needs (done)" for finished ones). Built in board 1.10.3.
- REQ-7 A track's KPI (`**Serves**`, or a `KPI Check After`) is a button that opens the KPIs tab of the Project drawer, and a Discuss button next to Copy copies a prompt that asks Claude to read the track and talk it through without running a lane or changing a file. Built in board 1.10.3.

## Out of scope

The board add-on's refresh and hooks (done in 10115); the extra hooks of 10115 Phase 1 (not built, reopen as a new track if wanted).
