# Tests: Track 10143 - search first; allocation across branches; duplicate repair

Run: `cd connector && npm test` (or `node --test test/search-first.test.mjs test/create-branches.test.mjs` for the two files). Tests exist for every ticked case below; they were checked by reading the test code and the source, and were not run when this file was written (connector dependencies not installed in that checkout).

Search first (connector/test/search-first.test.mjs, REQ-6, REQ-7, REQ-8):
- [x] TC-1 (REQ-7): a track that matches the new work is listed in `similar_tracks` with number, title, lane and lane status, plus a warning; the create still happens.
- [x] TC-2 (REQ-7): nothing matches, `similar_tracks` is empty and there is no similar-track warning.
- [x] TC-3 (REQ-7): only a done track matches, it is listed and marked with lane done.
- [x] TC-4 (REQ-7): `similarTracks` returns at most 5, best first, searches the backlog, skips tracks without a lane.
- [x] TC-5 (REQ-6): the `new`, `bug` and `feature` procedures have the search-first flow in the connector and in the base (default-yes question, create as fallback, backlog lane named).
- [x] TC-6 (REQ-6): the skill file (ops/tracks.md) and the lane guides carry the rule.
- [x] TC-7 (REQ-8): the KC-8 context-size estimate stays within budget (connector/test/commands.test.mjs).

Allocation and duplicates (connector/test/create-branches.test.mjs, REQ-1, REQ-2, REQ-3):
- [x] TC-8 (REQ-2): `duplicateNumbers` reports one number under different folder names only (a `_duplicate-` name does not count).
- [x] TC-9 (REQ-1): a number that exists only on another local branch is not handed out (40 on a branch, new track is 41).
- [x] TC-10 (REQ-1): a number on a remote-tracking ref counts (77 on origin/feature, new track is 78).
- [x] TC-11 (REQ-2): two folder names for one number on the state branch is a Duplicate warning that names the repair command.
- [x] TC-12 (REQ-3): the `repair-duplicates` command text asks first (default yes), renames the newer folder with git mv, never pushes, uses explicit paths, asks which branch is the keeper when the second folder is only on another branch; commands and coverage tests list it.
- [ ] TC-13 (REQ-5): the `possibly_stale` only-ahead noise is dropped and `behind_upstream` is kept. Skipped, not built; owner decides keep or drop.
- [x] TC-14 (REQ-2): a folder named differently only on an unmerged branch gives the softer note, not a Duplicate warning.
- [x] TC-15 (REQ-2): a duplicate renamed by repair, old name still on an unmerged branch: no Duplicate warning; the branch note goes once it is merged.
- [x] TC-16 (REQ-1): more than 100 branch tips gives one cap warning (at most 200 characters, final period); a few branches give none.
- [x] TC-17 (REQ-4): the board lists a `_duplicate-` folder as archived (connector/test/board.test.mjs).
- [ ] TC-18: the full suite is green and the three plugins pass strict validate. Not verified here.
