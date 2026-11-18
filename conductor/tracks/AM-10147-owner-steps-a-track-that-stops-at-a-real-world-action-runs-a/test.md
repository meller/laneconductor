# Tests: Track 10147 (owner steps)

Run command: `cd connector && npm test` (new files proposed: `owner-steps.test.mjs`, additions to `next.test.mjs`, the board tests and the text tests), `node scripts/build-plugin.mjs --check`, `claude plugin validate --strict` on the three plugins and the root. HUMAN cases are run in a real session. None of these cases has a test yet.

## Markers and the connector

- [ ] TC-1 (REQ-1): a track with none of the new markers behaves exactly as before in `list_tracks`, `get_track`, `next` and the board
- [ ] TC-2 (REQ-1): `Owner Action`, `Owner Action Due` and `Result` are read with the same rules as the others (first match wins, case-insensitive names including a hand-typed `**owner action**`, CRLF) and `update_track` sets and removes them; a value over 200 characters is shortened in listings, with the full text in `get_track`
- [ ] TC-3 (REQ-5, REQ-6): `overdue` is true only when `Owner Action Due` is before today (UTC) and the track is waiting; due today is not overdue; `ready_to_measure` is true when `KPI Check After` is today or earlier and the track is waiting; a due date on a track that is not waiting sets neither flag; a due date without an `Owner Action` is reported, not flagged
- [ ] TC-4 (REQ-7): dates: `2026-02-30`, `2026-13-01`, an empty value, `2026-1-5`, an ISO timestamp, a trailing space and CRLF are `date_malformed` with no guess; the boundaries (due today, `KPI Check After` today, UTC midnight crossing) are covered with a fixed clock
- [ ] TC-5 (REQ-7): `outcome_missing` fires for a marketing or sales track with a `## KPI` block at `done:success` and neither `KPI Actual` nor `Result` (also for `Marketing` in other case and a blank `Result:` line); not for a dev track, not for one with `Result: killed: ...`, not for `done:queue`, not for an older track without a KPI block; it is a warning and never blocks a write
- [ ] TC-6 (REQ-3): a waiting track with an `Owner Action` and no `Waiting Reason` does not trip the existing waiting lint
- [ ] TC-7 (REQ-1): no new tool and no change to the tool descriptions; the context-size test still passes with ten tracks whose markers are 200 characters long; `generateSummary` stays free of a clock and `checkSummary` does not churn from one day to the next

## next

- [ ] TC-8 (REQ-5): a waiting track with an owner action is its own state ahead of S05, with the action, due date and the `## Draft` pointer; the old S05 text is not shown for it; overdue first, then oldest due; no due date or a malformed one shows last with the reason
- [ ] TC-9 (REQ-5): a track past `KPI Check After` is offered as a measurement with `/laneconductor:quality-gate N`
- [ ] TC-10 (REQ-5): with three open owner actions `next` adds one line of advice; with two or fewer nothing; the advice never changes the order; the ordering with Priority, with a met and an unmet `Depends On`, with S09 (resume) and with an action in `done:waiting` and in an epic is fixed by fixtures
- [ ] TC-11 (REQ-5, REQ-10): the text of `ops/next.md` and the code agree (the existing comparison test and the state-count assertion are updated), and the text tells an agent without the connector to compare dates with today's date and to ask when it does not know it

## Board

- [ ] TC-12 (REQ-6): the card and What's next show the action and due date; overdue is computed at render and marked in text and colour; a window ready to measure shows; tracks without the fields look as before; an old `board.json` renders
- [ ] TC-13 (REQ-6, REQ-7): needs-attention lists an overdue action, a malformed date and a window ready to measure with the reason in words, also for a track that is overdue and stale-running
- [ ] TC-14 (REQ-6): the free text of `Owner Action` is escaped on the card and in the drawer (a script tag in the text does not run); at 400 px nothing scrolls sideways and both themes work

## Lane guides

- [ ] TC-15 (REQ-4, REQ-8): the implement guide for a non-dev track writes `Owner Action` and `Owner Action Due` before `Waiting for reply: yes`; the reply handling clears both, sets `KPI Check After` to now plus the KPI Window and parks the track in the quality gate with a Waiting Reason naming the date; the text says nothing is posted, sent or spent for the owner
- [ ] TC-16 (REQ-8): the quality gate writes `Result` and a history line after its KPI step; with the window used up and the threshold missed it applies the kill rule (`done:success`, `killed:` in `Result`); it never invents a number and asks the owner when the source cannot be read
- [ ] TC-17 (REQ-2, REQ-9): no new heading, no new file and no campaign template, channel kit or readout format in the base; the added text is written once and shared; the sizes of the affected commands before and after are recorded and the size tests, the README word limit and the 256 KiB limit pass
- [ ] TC-18 (REQ-10): the base text says once that the lint, the computed flags and the board need the connector or the board add-on, and that without them the agent reads and writes the markers by hand

## Real use (HUMAN)

- [ ] TC-19 (HUMAN): one real marketing track goes through prepare, owner action, run window, measurement and close; `next` and the board showed the action, the due date and the window end at the right times; nothing was posted, sent or spent by the agent; record what was missing or noisy
