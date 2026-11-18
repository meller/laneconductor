# Track 10135: Done lane truth

In the plugin world `done:queue` is gated, not merged; `done:success` is shipped. Only shipped work is quiet.

## Phase 1: list_tracks
- [ ] default list hides only `done:success`; `include_done` still shows every done track; `lane: done` shows all
- [ ] optional `check_merged`: for each listed done track, `merged` true / false from `git merge-base --is-ancestor` of the `track-NNN` branch against the state branch; no field when there is no such branch (merged and deleted, or worked on main); a warning for a done:success track whose branch is NOT merged

## Phase 2: board
- [ ] attention reasons for `done:queue` (gated, not merged), `done:failure` (merge failed), `done:waiting` (waiting on a human, PR open); `done:success` stays quiet

## Phase 3: text and verify
- [ ] skill text says what each done status means for the list and the board
- [ ] KC-8 passes; `cd connector && npm test` green; build-plugin --check clean

Not done on purpose: the board is a pure function of index.md files and does not run the merged check (it has no repository to ask); the check is a list_tracks option.
