# Tests: Track 10146 - Track file roles: plan, spec, test, a tracked history.md for the run log, and a lint for a plan that holds a log

Run command: `cd connector && npm test` (that is `node --test "test/*.test.mjs"`); one file: `node --test connector/test/track-files.test.mjs`. The suite passes 654/654 at plugins 1.6.0 (593 at the release of the contract); the drift check and `claude plugin validate --strict` are clean.

- [x] TC-1: create_track creates `history.md` with a one-line header, committed with the track; `conversation.md` stays untracked (connector/test/track-files.test.mjs)
- [x] TC-2: append_conversation with author system lands in `history.md` as a dated line and is committed; the answer names the file (track-files.test.mjs)
- [x] TC-3: human, claude and gemini entries stay in `conversation.md` and are not committed (track-files.test.mjs)
- [x] TC-4: an older track without `history.md` gets it with its first system entry; lines append in order; multi-line text is one line (track-files.test.mjs)
- [x] TC-5: a system body that is already a turn or a dated line is refused and nothing is written; the line format is a UTC minute stamp on one line (track-files.test.mjs)
- [x] TC-6: the scaffold creates an empty `history.md` beside each first track and its `.gitignore` lines do not ignore it (track-files.test.mjs)
- [x] TC-7: plan_has_log on fixtures: a clean plan and a plan with many task checkboxes are not flagged; exactly one dated heading is clean, two are a log; STATUS, RELEASE, INCIDENT, UPDATE and LOG headings count (any case, with an emoji), a numbered section or a fenced heading does not; a plan over 60 KB is flagged without any dated heading (track-files.test.mjs)
- [x] TC-8: get_track warns within 200 characters and names the file and the count, a clean track has no such warning; list_tracks gives ONE aggregate line with the count and the first track numbers; the summary lint lists the track and the generated summary does not change when only a checkbox is ticked (track-files.test.mjs)
- [x] TC-9: `ops/tracks.md` has the contract: a table of the six files, plan.md as the task tracker, the history line format and the splitting procedure (track-files.test.mjs)
- [x] TC-10: the plan lane guides (skill and bundled) and SKILL.md name the contract, the other lane guides carry the one-line rule, and the scaffold's `workflow.md` template carries the contract (track-files.test.mjs)
- [x] TC-11: the shipped base text has no daemon-era words, no `lc` command and no track number in the contract sections; the generated commands carry the contract and the built base plugin is Markdown only (track-files.test.mjs)
- [x] TC-12: create_track noise fix: 200 stale unmerged branches that name numbers differently give no note in the create answer (connector/test/create-branches.test.mjs)
- [x] TC-13: create_track noise fix: only recent branches count; at most 3 are shown, then '+N more' and the repair-duplicates pointer, within 200 characters; no old branch is shown (create-branches.test.mjs)
- [x] TC-14: the context-size test passes: the tool descriptions did not grow
- [ ] TC-15 (HUMAN): this repo's open tracks: no '(To be filled in.)' text, no placeholder plan or test.md, no repeated headers, no plan_has_log warning left in list_tracks (AC-8)
- [ ] TC-16 (HUMAN): otralingo AM-1259 after its own agent restructured it: plan.md holds phases and checkboxes only, the dated sections are in history.md, the design is in spec.md, nothing was deleted, and the owner has seen it (AC-9)
