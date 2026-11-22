# Tests: AM-10155

## Test Commands
- `cd connector && npm test` (look for `# fail 0`); `node scripts/build-plugin.mjs --check`; `claude plugin validate . --strict`
- `node connector/bin/lc-explain.mjs --repo . --track 10154`

## Test Cases
- [x] TC-1 (REQ-2): a synthetic repository with a lane claim, three plan ticks and a completion line yields one lane run with three phases and the right boundaries
- [x] TC-2 (REQ-3): a synthetic transcript with known token counts, a `(HUMAN)` task between two agent tasks and a sub-agent run gives exactly the expected agent time, human time, token split and sub-agent share
- [x] TC-3 (REQ-4): a transcript whose content holds a token and an email never produces either in the printed table or in `explain.md`
- [x] TC-4 (REQ-5): running twice gives the same `explain.md` apart from the generated-at line; the file names its sources
- [x] TC-5 (REQ-6): the board for a track with an `explain.md` has the "Agent run" tab; a withheld file (a secret match) shows the standard placeholder
- [x] TC-6 (REQ-7): `git diff` of the base plugin across the track is empty
- [x] TC-11 (D3): every printed table and `explain.md` carries the approximation note (overlapping tracks, other machine activity, different execution machines)
- [x] TC-9 (REQ-2, D3): a transcript that spans two tracks in one session is cut at the lane boundaries; messages outside every window are counted under none
- [x] TC-10 (D1, REQ-6): the project Statistics tab lists every track that has an `explain.md`, done tracks included
- [x] TC-7 (REQ-8): the real run on 10154 prints a table whose lane totals are within a few percent of the transcript's own totals
- [x] TC-8 (REQ-9): every number in the post is traceable to the real output, and the status line moved from draft to reviewed

- [x] TC-12 (D7): the board page of a track without `explain.md` has the empty state and the Run statistics button, and the copied prompt names `lc-explain.mjs`, the track number and `explain.md`, and contains no private path or name
- [x] TC-13 (D7): the Statistics tab lists a finished track without `explain.md` as "no statistics recorded"

- [x] TC-14 (D10): a synthetic window where a sub-agent message precedes the first main-session message reports the main message's context, and the sub-agent-only window falls back
- [x] TC-15 (D11): a board built for a project with 300 finished tracks stays under the file limit, a finished track opens with its documents loaded from a shard, and a document with a secret match is withheld as before
- [x] TC-16 (D11): the footer text says that finished tracks are included in what sharing the board shares
- [x] TC-17 (D12): the published post no longer contains the 646,000 to 958,000 and 95,000 to 770,000 claims, and every number left in it traces to a total

- [x] TC-18 (D13): a synthetic explain with a long main session, a human wait of most of the wall time, a lane with no claim commit, a repeated read, a gap over 30 minutes and a step of 5 minutes starts with `## Insight` and each of those rules appears; a quiet synthetic explain says nothing unusual; no prompt, message or file content appears in the insight
- [x] TC-19 (D14): statistics.md starts with its own `## Insight`, and reading the explain.md files back (with the new section) gives the same tables as before
- [x] TC-20 (D13): in the board page, the Agent run tab of a track with an explain opens on the insight (it is the first section of the rendered document)

- [ ] TC-21 (D16): a synthetic transcript with two models, thinking tokens and two effort levels gives the exact model mix, thinking share and effort levels per lane and phase, and every existing total is unchanged
- [ ] TC-22 (D15, D16): each recommendation rule has a fires and a stays-quiet test at its limits (400,000 and 399,999 tokens, 30 percent sub-agent share, 80 percent mechanical tool calls, 30 percent thinking, 5 minutes), the suggested setup names a lane, a place, a model tier and an effort, and the quiet case says "No change suggested"
- [ ] TC-23 (D17): the Path of a phase is the run-length encoded tool kinds in order, cut to 8 segments, with no tool input or output content
- [ ] TC-24 (D18): statistics.md recommendations across tracks give the model mix of all replies, the share of unclaimed lane runs and the tracks where most rules fired
- [ ] TC-25 (REQ-4): the recommendations contain only numbers, model ids, tool names and times; a transcript with a token, an email and a prompt never reaches them
- [ ] TC-26 (D15): in the board page, the Agent run tab shows Recommendations right after Insight

## Acceptance Criteria
- [x] The script runs on a real finished track and the numbers match the transcript totals
- [x] No prompt, message or file content appears in any output
- [x] The board shows the tab; no base plugin text changed
