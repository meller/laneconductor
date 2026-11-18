# Tests: Track 10141 - Stale running claims and human comments mid-run

Command for all cases: `cd connector && npm test` (or `node --test test/claims.test.mjs` for the file alone). File: `connector/test/claims.test.mjs`.

- [x] TC-1 (REQ-1, REQ-2, REQ-3): `claimStamps` stamps a claim, leaves a re-claim and a progress edit alone, removes the stamps on release, respects explicit values.
- [x] TC-2 (REQ-5): `staleRunning` flags only a stamped running claim older than the limit.
- [x] TC-3 (REQ-7): `humanCommentSince` is true for a changed conversation whose newest turn is the human's.
- [x] TC-4 (REQ-1, REQ-3): through the connector, claiming stamps Run Started and Run By outside the base, a progress edit keeps them, releasing removes them and the returned base follows.
- [x] TC-5 (REQ-5): a stale claim is reported by get_track, list_tracks and the board; a fresh one is not.
- [x] TC-6 (REQ-7): a human comment after the caller's read warns on a Lane Status change; no warning once the read is current.
- [x] TC-7 (REQ-4, REQ-8): a 44-character client name is capped in Run By and the stale warning still fits 200 characters with its final period.
- [x] TC-8 (REQ-2, REQ-3): a Lane-only move while running re-stamps; replacing index.md with a non-running status drops the stamps.
- [ ] TC-9 (REQ-6): the summary lint does not report a stale claim. No dedicated test yet.
- [ ] TC-10: the branch-commit check. Not built, needs an owner decision to descope.
- [ ] TC-11: the resting-state lint. Not built, needs an owner decision to descope.
