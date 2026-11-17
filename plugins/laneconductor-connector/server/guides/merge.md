# merge lane (bundled guide)

Goal of the lane: integrate the track's code and record that it landed.

What has worked:
1. Ask the human before merging or pushing. This is the one place the advice is firm: the human decides.
2. Check the branch is up to date with the target, the tests pass after the merge, and the track's index.md says what was merged (commit or PR URL).
3. Only after the merge is reachable from the main branch, record it with update_track (`Lane`: done, `Lane Status`: success).

Why: "done" should mean reachable from main, otherwise the board lies.
