# Track 10147: Owner steps: a track that stops at a real-world action, runs a window, and closes with a result

The design is in spec.md. Builds on track 10136 (Waiting Reason, ready-to-resume), the board work of track 10115 and the advisor of track 10124 (the marketing pack and the work-in-a-track rule).

## Phase 1: Confirm the design (owner)

- [ ] Task 1 (HUMAN): confirm or change the four proposed decisions in spec.md (general owner step, template not a new Type, cap as advice, a killed campaign closes as done:success with `killed:` in `Result`)
- [ ] Task 2: review the plan with the read-only plan reviewer and fix its gaps

## Phase 2: Markers and the connector

- [ ] Task 1: Document the five markers in the skill's marker table (SKILL.md and ops) and in the lane guide text for non-dev tracks
- [ ] Task 2: `list_tracks` and `get_track` return `owner_action`, `owner_action_due`, `resume_on`, `result`, `source_tag` and the computed `overdue` and `readout_due` (a date compare against today, UTC); a malformed date is reported as a warning, never guessed
- [ ] Task 3: The `result_missing` lint for a marketing or sales track at `done` with no `Result`; tests; no new tool description text

## Phase 3: next

- [ ] Task 1: Add the candidate classes "owner action" and "readout due" to the shared ranking (`connector/src/next.mjs`); overdue first, then oldest due; one advice line above two open actions
- [ ] Task 2: Fixtures and tests in the style of `next.test.mjs` (a waiting track with an action, an overdue one, a readout due, three open actions, none of the markers)
- [ ] Task 3: The `next` text for the base plugin (Markdown, short) and the generated command

## Phase 4: Board

- [ ] Task 1: `board.json` carries the owner-step fields only for tracks that have them; the card shows the action and due date; an overdue action is marked in text and colour; What's next shows the kit pointer
- [ ] Task 2: Needs-attention lists an overdue action and a readout due, with the reason in words
- [ ] Task 3: Tests in the style of `board-type.test.mjs`; check the page at phone width and in both themes

## Phase 5: Lane guides for non-dev tracks

- [ ] Task 1: Implement (supervised) ends the prepare stage with the `## Kit` and the kill rule in spec.md, then sets `waiting` with `Owner Action`, `Owner Action Due` and (when known) `Resume On`
- [ ] Task 2: Review at `Resume On` does the readout: reads the numbers from where the project says, writes `Result` and one history line, applies the kill rule, never invents a number
- [ ] Task 3: Quality gate and review check `Result` before a marketing or sales track closes
- [ ] Task 4: Keep the added base text small (the commands are size-checked) and regenerate; text tests for each guide

## Phase 6: Skills outside the core

- [ ] Task 1: Write the campaign template, one channel-kit template and the readout format as skills in the owner's own skills library (not in this repository's plugins)
- [ ] Task 2: If the marketing pack in the advisor catalog should name them, add an entry through the catalog and its checker (track 10124 rules: public sources only)

## Phase 7: Release and real use

- [ ] Task 1: Version bump, regenerate, full tests, drift check, strict validation of all three plugins and the root, then release
- [ ] Task 2 (HUMAN): one real marketing track runs through prepare, owner action, run, readout and close; record what was missing or noisy

**Impact**: A track that needs the owner no longer sits unseen: it names one action with a ready kit and a date, `next` and the board put it in front of the owner, and the track closes with a result instead of fading.
