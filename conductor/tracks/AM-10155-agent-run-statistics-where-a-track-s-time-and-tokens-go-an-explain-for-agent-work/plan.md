# Plan: AM-10155

## Phase 1: Probe the data
- [x] Task 1: Repeat the probe of the spec's "Probe findings" on a plain CLI session and on a worktree session, and write down what differs (REQ-1, REQ-3)
- [x] Task 2: Settle the two open questions in the spec and fold the answers into the decisions D1 to D5

## Phase 2: The script
- [x] Task 3 (test first): Boundaries from the track files and git: lane runs and phases with their start and end (REQ-2)
- [x] Task 4: Attribute transcript messages to a lane or phase by time window and working directory; agent time versus human time from the `(HUMAN)` markers and waiting lines (REQ-2, REQ-3, D4)
- [x] Task 5: Token split, tool calls by kind, slowest steps, sub-agent share, repeated reads as counts (REQ-3)
- [x] Task 6: Write `explain.md` (generated, overwritten, with its sources and time) and print the same table (REQ-1, REQ-5)
- [x] Task 7: The privacy test: a transcript with a token and an email in its content never reaches the output (REQ-4)

## Phase 3: The board
- [x] Task 8: Publish `explain.md` as a document and show an "Agent run" tab with the per-phase table; decide the done-track question (REQ-6)
- [x] Task 9: The board plugin version and generated plugin, tests, strict validation; confirm no base plugin file changed (REQ-7)
- [x] Task 14 (test first): The "Agent run" tab of a track with no `explain.md` shows "No statistics yet" and a **Run statistics** button that copies the prompt of D7 (board page, add-on only) (D7)
- [ ] Task 15: The Statistics tab marks a finished track that has no `explain.md` as "no statistics recorded" (D7)
- [ ] Task 16: Board add-on version bump, regenerate, tests, strict validation; confirm no base plugin file changed (REQ-7)

## Phase 4: Use it
- [x] Task 10: Run it on 10154 and one or two other finished tracks; record the findings and the biggest inefficiencies in the spec (REQ-8)
- [x] Task 11 (HUMAN): Decide from the findings whether the lanes should run it at completion (a separate track, base text): decided, see D6 to D9 in the spec

## Phase 5: The post
- [x] Task 12: Fill "Pick Your Agent's Brain" with the real output, check every number, move it from draft to reviewed (REQ-9)
- [x] Task 13 (HUMAN): Approve and publish the post

## Phase 6: Corrections and finished tracks (2026-11-22)
- [x] Task 17 (test first): the first response of a lane run is the first message of the main session: a window where a sub-agent message comes before the main one gives the main one's context; with no main message it falls back to the sub-agent's (D10)
- [x] Task 18 (test first): the documents of finished tracks are published in shards and a finished track opens in the page with its tabs, Agent run included; the secret scan, the settings and the file limit hold; the footer says finished tracks are included (D11)
- [x] Task 19: board add-on version bump to 1.10.14, regenerate, tests, strict validation; confirm no base plugin file changed (REQ-7)
- [x] Task 20: correct the published post (D12) and deploy it, owner's word for the deploy

## ✅ QUALITY PASSED

## Phase 7: The insight first (2026-11-22)
- [x] Task 21 (test first): `explain.md` starts with `## Insight` right after the title, built by the rules of D13 from the numbers only (no content): each rule has a test that fires and one that stays quiet, and the nothing-unusual line (D13)
- [x] Task 22 (test first): `statistics.md` starts with the cross-track `## Insight` of D14; the parser that reads explain.md files for the statistics still works with the new section (D14)
- [x] Task 23: the board shows the Agent run tab and the Statistics tab opening with the insight; board add-on version 1.10.16, regenerate, tests, strict validation; base and parallel plugins unchanged (REQ-7)
- [x] Task 24: regenerate this project's explain.md files with the new script and refresh the boards, on the owner's word (D13)

## ✅ QUALITY PASSED (phase 7)

## Phase 8: Recommendations for the next run (2026-11-22)
- [x] Task 25: Probe the fields in the main and sub-agent transcripts (model per reply, thinking tokens, effort per turn) on three real tracks and write down what is missing (D15 to D17)
- [x] Task 26 (test first): model mix, thinking tokens and effort levels per lane and phase are computed from the transcripts (numbers only) and shown in the details, without changing any existing total (D16)
- [x] Task 27 (test first): `## Recommendations` right after `## Insight`: each rule of D16 has a test that fires and one that stays quiet, the thresholds are named constants, each recommendation carries its evidence number, and the quiet case says "No change suggested" (D15, D16)
- [x] Task 28 (test first): the per-phase Path of D17 (run-length encoded tool kinds, first 8 segments)
- [x] Task 29 (test first): `statistics.md` recommendations across tracks (D18)
- [x] Task 30: the board shows Recommendations right after the Insight; board add-on 1.10.17, regenerate, tests, strict validation; base and parallel plugins unchanged (REQ-7)
- [ ] Task 31 (HUMAN): the owner reads the recommendations of two real tracks, says which are useful, and the thresholds and wording are adjusted
- [x] Task 32: regenerate this project's explain files and refresh the boards, on the owner's word

## Phase 9: A short plan first, and recommendations across tracks (2026-11-22)
- [x] Task 33 (test first): `lc-explain.mjs` writes a short plan at the top of `explain.md`: one table (Step, Where, Time, Written, Context at start, expensive marker) and at most three fix lines with their numbers; the existing sections are unchanged and keep their numbers (D19, D20)
- [x] Task 34 (test first): `explain.md` carries a fenced `json` block `recommend-facts` with the rule ids that fired and their numbers, and nothing else (no content; REQ-4) (D23)
- [x] Task 35 (test first): the cross-track ranking: window of 10, at least 3 tracks per action, ranked by tracks affected then tokens, "Not enough tracks" and "No change suggested" cases, tracks without the block counted as not measured (D21, D22)
- [x] Task 36: the Agent run tab shows the short plan first with the rest folded under "Details"; the compact table style from phase 6 applies (D19)
- [x] Task 37: the board's "Agent recommendations" button and drawer: at most three actions, one number each, a Copy button, the list of tracks looked at, the empty and not-enough states (D21, D22, D24)
- [x] Task 38: board add-on 1.10.19 (1.10.18 is taken by track 10156; the next free version), `build-plugin --check`, tests, strict validation; base and parallel plugins unchanged (REQ-7)
- [ ] Task 39: regenerate this project's explain files and refresh the board, on the owner's word
- [ ] Task 40 (HUMAN): the owner reads the short plan of one track and the recommendations drawer and says whether it is clear enough to act on

## Phase 10: discuss the recommendations, and one window is not credited to many tracks (2026-11-22)
- [ ] Task 41 (test first): a lane window that is not a claimed running window and overlaps another track's window in the same lane is `not measured (shared window)`: two tracks with one overlapping unclaimed window are both not measured, a single track's window is unchanged, a claimed running window is unchanged; the shared run is left out of totals, statistics and the token rules; run on AM-10130 and AM-10154 with `--no-write` (D26)
- [ ] Task 42 (test first): the Statistics tab has a **Discuss actions from stats** button at the top that copies a plain prompt (read statistics.md and its Recommendations, say which apply, discuss each, change nothing without a yes; no private path or name) (D25)
- [ ] Task 43 (test first): the Agent recommendations drawer has a **Discuss all** copy button with the same kind of prompt over the actions shown (D25)
- [ ] Task 44: board add-on 1.10.20, `build-plugin`, `--check`, tests, strict validation; base and parallel plugins unchanged (REQ-7)
