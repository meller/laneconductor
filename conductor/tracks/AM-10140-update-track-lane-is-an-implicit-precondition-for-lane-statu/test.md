# Tests: Track 10140 - update_track: Lane is an implicit precondition for Lane Status, leaving done needs reopen

All in `connector/test/update-track-guards.test.mjs`.

- [x] TC-1 (regression): a Lane Status-only write from a base that predates a human lane move is a CONFLICT naming Lane, nothing written.
- [x] TC-2: the CONFLICT carries `error.base` (current markers, empty files) and a marker retry with it works.
- [x] TC-3: a Lane Status write from a current base works; Lane plus Lane Status in one call works.
- [x] TC-4: done to plan is refused without `reopen` (markers and files.index), staying in done is fine, `reopen: true` works.
- [x] TC-5: a stale base to leave done is a CONFLICT, not the done refusal.
