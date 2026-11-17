# Tests: Track 10115

- [ ] TC-1: Each hook script, fed recorded input: H1 brief is 5 lines or fewer and empty outside a project; H2 offers once for a lane move and never for a Progress-only change; H3 asks once per turn only with `board.auto_update`; H4 denies a diff with a fake secret (file and line, not the text) and allows a clean one; H5 asks, never denies; H6 prints instructions; H7 prints one line; every script exits 0 within 100 ms outside a project
- [ ] TC-2: The generated plugin contains hooks/hooks.json, the script, two commands and the agent; the validate and directory pre-check tests pass
- [ ] TC-3: The hook script names no path except `${CLAUDE_PLUGIN_ROOT}/...`, contains no package launcher, no network call
- [ ] TC-4: Board page: with a stubbed `sample`, "Review the plan" shows the answer; with null or `not_granted` the button is absent; a track whose plan was withheld by the scan sends nothing
- [ ] TC-5 (HUMAN): real session lane-end offer; real board review; the mcp spike result recorded
