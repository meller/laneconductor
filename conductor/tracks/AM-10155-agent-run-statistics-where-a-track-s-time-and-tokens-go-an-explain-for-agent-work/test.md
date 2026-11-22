# Tests: AM-10155

## Test Commands
- `cd connector && npm test` (look for `# fail 0`); `node scripts/build-plugin.mjs --check`; `claude plugin validate . --strict`
- `node connector/bin/lc-explain.mjs --repo . --track 10154`

## Test Cases
- [ ] TC-1 (REQ-2): a synthetic repository with a lane claim, three plan ticks and a completion line yields one lane run with three phases and the right boundaries
- [ ] TC-2 (REQ-3): a synthetic transcript with known token counts, a `(HUMAN)` task between two agent tasks and a sub-agent run gives exactly the expected agent time, human time, token split and sub-agent share
- [ ] TC-3 (REQ-4): a transcript whose content holds a token and an email never produces either in the printed table or in `explain.md`
- [ ] TC-4 (REQ-5): running twice gives the same `explain.md` apart from the generated-at line; the file names its sources
- [ ] TC-5 (REQ-6): the board for a track with an `explain.md` has the "Agent run" tab; a withheld file (a secret match) shows the standard placeholder
- [ ] TC-6 (REQ-7): `git diff` of the base plugin across the track is empty
- [ ] TC-11 (D3): every printed table and `explain.md` carries the approximation note (overlapping tracks, other machine activity, different execution machines)
- [ ] TC-9 (REQ-2, D3): a transcript that spans two tracks in one session is cut at the lane boundaries; messages outside every window are counted under none
- [ ] TC-10 (D1, REQ-6): the project Statistics tab lists every track that has an `explain.md`, done tracks included
- [ ] TC-7 (REQ-8): the real run on 10154 prints a table whose lane totals are within a few percent of the transcript's own totals
- [ ] TC-8 (REQ-9): every number in the post is traceable to the real output, and the status line moved from draft to reviewed

- [ ] TC-12 (D7): the board page of a track without `explain.md` has the empty state and the Run statistics button, and the copied prompt names `lc-explain.mjs`, the track number and `explain.md`, and contains no private path or name
- [ ] TC-13 (D7): the Statistics tab lists a finished track without `explain.md` as "no statistics recorded"

## Acceptance Criteria
- [ ] The script runs on a real finished track and the numbers match the transcript totals
- [ ] No prompt, message or file content appears in any output
- [ ] The board shows the tab; no base plugin text changed
