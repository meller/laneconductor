# Spec: Board page follow-ups (AM-10151)

Moved from track 10115 on 2026-11-19 (its plan tasks Phase 2 task 8, Phase 3 tasks 1 to 3, Phase 5 tasks 5 to 7).

## Requirements

- REQ-1 Verify, in the Claude desktop app with the parallel add-on running, that the board page reaches the connector as the host server `host:plugin_laneconductor-parallel_lc`: the Move menu changes a track's lane through `update_track` with a confirm step and shows a CONFLICT clearly, and "Check now" compares the board's commit with the repository. If the server string is wrong, fix it; if the page cannot reach the connector at all, remove the controls instead of leaving them.
- REQ-2 Look at the board by hand at 375 px width and in the light and dark themes: the Project drawer, the What's next panel, the freshness chip, the Move menu and the new "newer board" button.
- REQ-3 The Review-the-plan button in a track's detail view (the `sample` capability): a fixed instruction, the plan and spec text only when the privacy scan did not withhold them, a note that it is a separate Claude call that changes nothing; hidden when consent is not granted. Build it only if the owner wants it.
- REQ-4 By hand, on a scratch repository: `/laneconductor:status`, `:plan` and `:run`; confirm the subagent recommendation and that nothing starts unasked.

## Out of scope

The board add-on's refresh and hooks (done in 10115); the extra hooks of 10115 Phase 1 (not built, reopen as a new track if wanted).
