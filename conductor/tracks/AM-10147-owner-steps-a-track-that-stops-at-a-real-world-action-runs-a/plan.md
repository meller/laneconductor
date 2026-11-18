# Track 10147: Owner steps: a track that stops at a real-world action, runs a window, and closes with a result

The design is in spec.md. It reuses the KPI block, the `## Draft`, supervised implement, `KPI Check After` and the quality gate's KPI step, and adds only `Owner Action`, `Owner Action Due` and `Result`. Builds on track 10136 (Waiting Reason, ready-to-resume), the board work of track 10115 and the advisor of track 10124.

## Phase 1: Confirm and review

- [x] Task 1 (HUMAN): confirm or change the four proposed decisions in spec.md
- [x] Task 2: review the plan with the read-only plan reviewer; its gaps are answered in the rewritten spec (reuse of the KPI and Draft flow, the S05 and waiting-lint conflicts, the clock, the closing lint, base alone)

## Phase 2: Markers and the connector

- [x] Task 1: Add `Owner Action`, `Owner Action Due` and `Result` to the canonical marker names (so a hand-typed name is read), the row reader and the marker table in SKILL.md; say which source file is the one to edit (the repo's skill source under `.claude/skills/laneconductor/`, copied by the generator) and keep the drift check green
- [x] Task 2: One small pure function that takes today's date and a row and returns `overdue` and `ready_to_measure` (strict `YYYY-MM-DD` pattern plus a calendar round-trip; due today is not overdue; `KPI Check After` today or earlier is due; a flag is omitted when unset); `list_tracks` and `get_track` use it with `ctx.now()` (UTC); the summary generator stays free of a clock
- [x] Task 3: `Owner Action` satisfies the existing waiting lint; `date_malformed` and `outcome_missing` warnings (REQ-7) in `get_track`, `list_tracks` and the Needs attention block; no new tool and no new tool description text; check the context-size margin with ten tracks that all have 200-character markers
- [x] Task 4: Tests for the markers, the dates (see test.md) and the lints

## Phase 3: next

- [x] Task 1: Add the states "do the owner action" and "measure the KPI" to the shared ranking (`connector/src/next.mjs`) with ids, SHAPES, text and word rows; the owner-action state sits ahead of S05 for tracks with an `Owner Action`; the cards name the action, the due date and the `## Draft` pointer, and the measure state names `/laneconductor:quality-gate N`; a missing or malformed due date still shows, last, with the reason
- [x] Task 2: The advice line above two open owner actions (never changes the order); update `ops/next.md` and the test that compares it with the code; the state-count assertion
- [x] Task 3: Fixtures and tests (a waiting track with an action, an overdue one, a window ended, three open actions, none of the markers, interaction with S05, S09, Priority and Depends On)
- [x] Task 4: The generated `next` command text; record its size before and after

## Phase 4: Board

- [x] Task 1: `board.json` carries the fields only for tracks that have them; the card and What's next show the action and due date; the page computes overdue at render from the UTC date and says so; a window ready to measure is shown
- [x] Task 2: Needs-attention lists an overdue action, a malformed date and a window ready to measure, with the reason in words
- [x] Task 3: Tests in the style of `board-type.test.mjs` including escaping of the free text; check the page at phone width and in both themes

## Phase 5: Lane guides

- [x] Task 1: Supervised implement writes `Owner Action` and `Owner Action Due` before `Waiting for reply: yes`; the reply handling of REQ-4 (clear both markers, set `KPI Check After`, park in the quality gate with a Waiting Reason naming the date); written once in the shared text
- [x] Task 2: The quality gate, after its KPI step, writes `Result` and a history line and applies the kill rule (`done:success` with `killed:` in `Result`); the readout never invents a number
- [x] Task 3: Keep the added base text small: merge into the existing KPI and Draft text, no new heading, no repeat per guide; regenerate and record the size of each affected command before and after
- [x] Task 4: Text tests for each guide; state in the base text that the lint, the computed flags and the board need the connector or the board add-on

## Phase 6: Skills outside the core

- [ ] Task 1: Write the campaign template, one channel-kit template and the readout format as skills in the owner's own skills library (not in this repository's plugins); record where they are
- [ ] Task 2: If the advisor's marketing pack entry should name them, add it through the catalog and its checker (public sources only)

## Phase 7: Release and real use

- [ ] Task 1: Version bump, regenerate, full tests, drift check, strict validation of all three plugins and the root, release note that the generated summary can gain warnings
- [ ] Task 2 (HUMAN): one real marketing track runs through prepare, owner action, run window, measurement and close; nothing is posted, sent or spent by the agent; record what was missing or noisy

**Impact**: A track that needs the owner names one action with a due date, `next` and the board put it in front of the owner, the window end is offered as a measurement, and the track closes with a result instead of fading.
