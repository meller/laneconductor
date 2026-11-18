# Track 10135: Done lane truth

In the plugin world `done:queue` is gated, not merged; `done:success` is shipped. Only shipped work is quiet.

## Phase 1: list_tracks
- [x] default list hides only `done:success`; `include_done` still shows every done track; `lane: done` shows all
- [x] merged check (no new input, because of the KC-8 budget): done tracks whose `track-NNN` branch exists get `merged` true / false from `git merge-base --is-ancestor` against the state branch. Checked for done:queue / failure / waiting always, and for all done tracks when include_done or lane done is asked. No field when there is no such branch; warnings for done:success with an unmerged branch and for done:queue already merged

## Phase 2: board
- [x] attention reasons for `done:queue` (gated, not merged), `done:failure` (merge failed), `done:waiting` (waiting on a human, PR open); `done:success` stays quiet

## Phase 3: text and verify
- [x] skill text says what each done status means for the list and the board
- [x] KC-8 passes; `cd connector && npm test` green; build-plugin --check clean

Not done on purpose: the board is a pure function of index.md files and does not run the merged check (it has no repository to ask); the check is in list_tracks.
