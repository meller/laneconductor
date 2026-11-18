# Tests: Track 10143 - search first; allocation across branches; duplicate repair

Run: `cd connector && npm test`.

Pass 1 (shipped, connector/test/search-first.test.mjs):
- [x] TC-1 to TC-7: similar_tracks match, no match, done-only, at most 5, command text, ops text, KC-8.

Pass 2 (connector/test/create-branches.test.mjs):
- [x] TC-8: `duplicateNumbers` reports one number under different folder names only.
- [x] TC-9: a number that exists only on another local branch is not handed out (40 on a branch, new track is 41).
- [x] TC-10: a number on a remote-tracking ref counts (77 on origin/feature, new track is 78).
- [x] TC-11: the same number under different folders on two branches is a create_track warning that names the repair command.
- [x] TC-12: the `repair-duplicates` command text asks first (default yes), renames the newer folder with git mv, never pushes, uses explicit paths; commands and coverage tests list it.
- [ ] TC-13: possibly_stale only-ahead noise (skipped, not built).
