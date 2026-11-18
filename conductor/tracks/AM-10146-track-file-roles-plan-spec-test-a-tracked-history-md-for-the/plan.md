# Track 10146: Track file roles: plan, spec, test, a tracked history.md for the run log, and a lint for a plan that holds a log

This plan is the task tracker: phases in order, each task one checkbox. The design is in spec.md, the test cases in test.md, the run log in history.md. Phases 1 to 5 shipped in plugins 1.5.0; Phase 6 is open.

## Phase 1: Contract text

- [x] Task 1: A section 'What goes in each track file' in `ops/tracks.md`: a table of the six files (index, spec, plan, test, history, conversation), what each holds and never holds, plan.md as the task tracker, the history line format (AC-1)
- [x] Task 2: The SKILL.md pointer and the plan lane guide (skill and bundled) name the contract; the plan guide says to move any dated status out of plan.md; review and quality-gate tick the spec acceptance criteria; the implementer ticks plan tasks and a task may name a REQ-n; the other lane guides carry the one-line rule
- [x] Task 3: `connector/guides` and the scaffold's `conductor/workflow.md` template (skill text and generator) carry the contract
- [x] Task 4: The generated commands carry the contract (the plan lane and the run command include both sections); the base stays Markdown only

## Phase 2: history.md

- [x] Task 1: `create_track` creates `history.md` with the header `# History: Track ID`, committed with the track; the scaffold creates an empty `history.md` beside each first track; the `.gitignore` lines stay (conversation ignored, history tracked) (AC-2)
- [x] Task 2: `append_conversation` with author `system` writes one dated line to `history.md` (tracked and committed with the track); an older track without `history.md` gets it with its first system entry; human, claude and gemini entries go to `conversation.md` and are not committed; the response names the file (AC-3)
- [x] Task 3: The line format: UTC minute stamp, one line, multi-line text folded into one; a system body that is already a turn or a dated line is refused and nothing is written
- [x] Task 4: The lane completion line and the 'Classified as Track Kind' note go to history.md as one dated line each; no new tool and no tool-description text (KC-8 budget)

## Phase 3: The plan lint

- [x] Task 1: `plan_has_log`: two or more dated or STATUS, RELEASE, INCIDENT, UPDATE or LOG headings (any case, with an emoji; a numbered section or a fenced heading does not count), or a plan over 60 KB; checkboxes are never counted; one dated heading is clean (AC-4)
- [x] Task 2: `get_track` warns within 200 characters and names the file and the count; `list_tracks` gives one aggregate line with the count and the first track numbers; the summary lint lists the track and does not change when only a checkbox is ticked
- [x] Task 3: The procedure 'Splitting a plan that holds a log' in `ops/tracks.md`: ask first, move not delete, decisions to spec.md, dated entries to history.md, checkboxes stay in the plan (AC-5)
- [x] Task 4: `ops/next.md` is not touched here

## Phase 4: The create_track note fix

- [x] Task 1: The 'also named differently on branch' note counts only recent branches (tips newer than 60 days), shows at most 3, then '+N more' and the repair-duplicates pointer, within 200 characters; 200 stale unmerged branches give no note (AC-6)

## Phase 5: Tests and release

- [x] Task 1: `connector/test/track-files.test.mjs` (19 tests) and two additions in `connector/test/create-branches.test.mjs`, mapped in test.md
- [x] Task 2: The context-size test passes (the tool descriptions did not grow); the shipped base has no daemon-era words, no `lc` command and no track number in the contract sections (AC-7)
- [x] Task 3: Released in plugins 1.5.0 (593 tests at the release of the contract, 654 after the board work); drift check and `claude plugin validate --strict` clean

## Phase 6: Apply the contract to the open tracks (owner, 2026-11-18)

Progress notes: 12 of the 21 open tracks of this repo are tidied by tidy agents (through the connector, one pilot first, the owner reviews). Left in this repo: placeholder test plans, the plans of a few tracks, and the dated status in plans that waits for a history.md split (ask first, never delete). The `next` display of the lint is not built and is out of scope here.

- [x] Task 1: Pilot in this repo reviewed by the owner, then the batch started
- [ ] Task 2: The remaining open tracks of this repo: no '(To be filled in.)' text in specs, no placeholder plan or test.md, no repeated headers (repair_index where needed), dated status moved to history.md with a yes per track (AC-8)
- [ ] Task 3: otralingo AM-1259 pilot: restructured by otralingo's own agent with the contract and the splitting procedure; the owner has the text and sends it; this repo's tooling never edits otralingo's files; one yes per track before any plan is split (AC-9)
- [ ] Task 4: The owner has seen the AM-1259 result before the other otralingo plans with a log (AM-1289, 1216, 1219, 1290) are split

**Impact**: Every track file has one job, the run history is tracked in git, and a plan that holds a log is flagged and has an ask-first way to be split.
