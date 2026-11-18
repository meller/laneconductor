# Tests: Track 10141 - Stale running claims and human comments mid-run

All in `connector/test/claims.test.mjs`.

- [x] TC-1: `claimStamps` stamps a claim, leaves a re-claim and a progress edit alone, removes on release, respects explicit values.
- [x] TC-2: `staleRunning` flags only a stamped running claim older than the limit.
- [x] TC-3: through the connector, claiming stamps Run Started and Run By, a progress edit keeps them, releasing removes them and the returned base follows.
- [x] TC-4: a stale claim is reported by get_track, list_tracks and the board; a fresh one is not.
- [x] TC-5: a human comment after the caller's read warns on a Lane Status change, not on a current read or a non-lane edit.
- [x] TC-6: the stale warning fits the 200 character bound.
