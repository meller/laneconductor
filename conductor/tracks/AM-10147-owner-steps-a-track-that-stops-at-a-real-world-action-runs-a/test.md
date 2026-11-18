# Tests: Track 10147 (owner steps)

Run command: `cd connector && npm test` (new files proposed: `owner-steps.test.mjs`, additions to `next.test.mjs` and the board tests), `node scripts/build-plugin.mjs --check`, `claude plugin validate --strict` on the three plugins and the root. HUMAN cases are run in a real session. None of these cases has a test yet.

## Markers and the connector

- [ ] TC-1 (REQ-1, REQ-9): a track with none of the five markers behaves exactly as before in `list_tracks`, `get_track`, `next` and the board
- [ ] TC-2 (REQ-1): the five markers are parsed with the same rules as the others (first match wins, case-insensitive names, CRLF), and appear in `list_tracks` and `get_track` as `owner_action`, `owner_action_due`, `resume_on`, `result`, `source_tag`
- [ ] TC-3 (REQ-4, REQ-5): `overdue` is true only when `Owner Action Due` is before today (UTC) and the track is `waiting`; `readout_due` is true only when `Resume On` is today or earlier and the track is `waiting`; a malformed date is a warning and neither flag is set
- [ ] TC-4 (REQ-6): a marketing or sales track at `done` with no `Result` gets `result_missing`; a dev track does not; a track with a `Result` does not; the lint is a warning, never a block
- [ ] TC-5 (REQ-1): `update_track` sets and removes the new markers with no new tool and no change to the tool descriptions (the context-size test still passes)

## next

- [ ] TC-6 (REQ-4): a waiting track with an owner action is listed with the action, its due date and the kit pointer; an overdue one comes before one not yet due; among equals the oldest due first
- [ ] TC-7 (REQ-4): a track past `Resume On` is offered as "read out track N"
- [ ] TC-8 (REQ-4): with three open owner actions `next` adds one line of advice to finish one first; with two or fewer it adds nothing; the advice never changes the order or blocks anything

## Board

- [ ] TC-9 (REQ-5): the card and the What's next panel show the owner action and due date; an overdue action is marked in text and colour; a track past `Resume On` shows as due for a readout; tracks without the fields look as before
- [ ] TC-10 (REQ-5): needs-attention lists an overdue action and a readout due with the reason in words
- [ ] TC-11 (REQ-5): `board.json` carries the fields only for tracks that have them; an older `board.json` renders; at 400 px width nothing scrolls sideways and both themes work

## Lane guides

- [ ] TC-12 (REQ-2, REQ-3, REQ-7): the implement guide for a non-dev track ends the prepare stage with a `## Kit` and a kill rule in spec.md and sets `waiting` with `Owner Action` and `Owner Action Due`; the text says nothing is posted, sent or spent for the owner
- [ ] TC-13 (REQ-7): the review guide at `Resume On` writes `Result` and a history line from the numbers it was given, says so when the numbers are not available, and never invents one
- [ ] TC-14 (REQ-6, REQ-7): review and the quality gate check `Result` before a marketing or sales track closes; a killed campaign closes as done:success with `killed:` in `Result`
- [ ] TC-15 (REQ-8): the base plugin carries no campaign template, channel kit or readout format; its commands stay within their size checks and the base README stays under its word limit

## Real use (HUMAN)

- [ ] TC-16 (HUMAN): one real marketing track goes through prepare, owner action, run, readout and close with the markers; `next` and the board showed the action and the due readout at the right times; record what was missing or noisy
