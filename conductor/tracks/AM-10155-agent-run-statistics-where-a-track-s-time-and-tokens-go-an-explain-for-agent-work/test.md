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

- [x] TC-21 (D16): a synthetic transcript with two models, thinking tokens and two effort levels gives the exact model mix, thinking share and effort levels per lane and phase, and every existing total is unchanged
- [x] TC-22 (D15, D16): each recommendation rule has a fires and a stays-quiet test at its limits (400,000 and 399,999 tokens, 30 percent sub-agent share, 80 percent mechanical tool calls, 30 percent thinking, 5 minutes), the suggested setup names a lane, a place, a model tier and an effort, and the quiet case says "No change suggested"
- [x] TC-23 (D17): the Path of a phase is the run-length encoded tool kinds in order, cut to 8 segments, with no tool input or output content
- [x] TC-24 (D18): statistics.md recommendations across tracks give the model mix of all replies, the share of unclaimed lane runs and the tracks where most rules fired
- [x] TC-25 (REQ-4): the recommendations contain only numbers, model ids, tool names and times; a transcript with a token, an email and a prompt never reaches them
- [x] TC-26 (D15): in the board page, the Agent run tab shows Recommendations right after Insight

### Phase 9: short plan and cross-track recommendations
- [x] TC-27 (D19, D20): a synthetic transcript gives a short plan table whose rows match the lane run numbers, the most expensive step marked, at most three fix lines, an approximation note, and every existing section and number unchanged
- [x] TC-28 (D23, REQ-4): the `recommend-facts` block holds only rule ids and numbers; a transcript with a token, an email and a prompt never reaches it
- [x] TC-29 (D21, D22): ten synthetic tracks give at most three ranked actions with their counts; 2 tracks give "Not enough tracks with statistics yet (2 of 3)"; 10 tracks with nothing over the threshold give "No change suggested"; an action firing in exactly 3 appears, in 2 does not
- [x] TC-30 (D19, D21): in the board page the Agent run tab opens on the short plan with Details folded, and the top button opens a drawer with the Copy buttons

### Phase 10: discuss and shared windows
- [x] TC-31 (D26): two tracks with one overlapping unclaimed window in the same lane are both `not measured (shared window)` with the run's time kept; one track alone is unchanged; a claimed running window is unchanged; the totals, statistics.md and the token rules leave shared runs out; AM-10154 is unchanged on the real transcripts
- [x] TC-32 (D25): the Statistics tab has the Discuss actions from stats button, it copies a plain prompt that names conductor/statistics.md and Recommendations and asks for a yes before any change, with no private path or name
- [x] TC-33 (D25): the Agent recommendations drawer has a Discuss all button that copies a prompt over the shown actions; the not-enough and no-change states have none

### Phase 11: one set of recommendations
- [x] TC-34 (D27): for the same explain.md texts, the `## Recommendations` of statistics.md lists exactly the actions `rankFromExplains` returns (same order, same counts, at most three), the folder name gives the track number (`AM-` prefixed or bare), a folder with no number is left out, the scope is the 10 newest tracks
- [x] TC-35 (D27): fewer than 3 measured tracks and a quiet project print the drawer's own messages; the model mix, the claim-commit share and the tracks where most rules fired are in the `## Insight` and no longer in the Recommendations

### Phase 12: levels, project lines, sub-agent start context
- [x] TC-36 (D30): a synthetic main session with 600,001 tokens of context and three sub-agents that start at 13,000 (before the first lane window), 20,000 (in the plan window, working again in the implement window with 250,000) and 55,000: the sub-agent starts of the implement run are 13,000, 20,000 and 55,000, its row says sub-agent with Context at start 20,000 (before the fix 600,001), a row made mostly of main-session replies keeps the main figure, a phase row marked sub-agent shows the median of its own starts, the main session's first-reply figure is unchanged (`explain.test.mjs`, `explain-plan.test.mjs`)
- [x] TC-29 (D28, rewritten): levels by share of the measured tracks (60 and 30 percent, whole-number arithmetic), every action that fired on one track or more is listed, High then Medium then Low then count, tokens and rule order, at most five, "Not enough tracks (N of 3)" and "No change suggested" kept, an action of two tracks of ten is Low (`explain-rank.test.mjs`, `board-recommend.test.mjs`)
- [x] TC-30 (D28): the drawer shows a High, Medium or Low badge per action, at most five rows, an unknown level draws no badge, Discuss all names the level (`board-recommend.test.mjs`)
- [x] TC-37 (D29): the `lane-facts` block (round trip, an older file or another version is null, malformed entries dropped, only the words where and context) and the two Insight lines with their counts and medians, the "not counted" note, "not measured yet", shared windows and runs with no reply left out (`explain-plan.test.mjs`, `explain-recommend.test.mjs`)
- [x] TC-38 (D28): statistics.md lists the same actions as the drawer with the same levels; the Low action of two tracks of ten and the Medium action of one track of three are in it (`explain-recommend.test.mjs`)
- [x] Real data (read-only): `lc-explain --repo <main folder> --track 10146 --no-write --now 2026-11-24T12:00:00Z` implement row 56,029 (before 788,792) and 10143 12,842 (before 418,606); the built script on a throwaway copy of the 15 real reports lists the same three actions with the same levels in statistics.md and in board.json `rec`

## Acceptance Criteria
- [x] The script runs on a real finished track and the numbers match the transcript totals
- [x] No prompt, message or file content appears in any output
- [x] The board shows the tab; no base plugin text changed
