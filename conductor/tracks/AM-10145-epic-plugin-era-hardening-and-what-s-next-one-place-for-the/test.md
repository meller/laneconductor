# Tests: Track 10145 - Epic: plugin-era hardening and "what's next" (one place for the order, the gaps and the notes)

Test command: `cd connector && node --test test/epics.test.mjs test/next.test.mjs` (whole suite: `cd connector && npm test`); `node scripts/build-plugin.mjs --check`.

- [x] TC-1: `Part Of` and `Priority` parse into the row only when set and valid (`epics.test.mjs`).
- [x] TC-2: the derived table lists children by number with lane, status, progress, a done count and `blocked_by`; none for a track without children.
- [x] TC-3: `list_tracks` and `get_track` show an epic its children; a child shows `part_of`; reading never edits the epic file or commits.
- [x] TC-4: a child finishing through `update_track` leaves the epic file byte-identical, and the derived table follows.
- [x] TC-5: the board data and page data carry `epics` only when one exists.
- [x] TC-6: `next` skips an epic as a candidate and reports its derived progress (fixture F32 in `next.test.mjs`).
- [ ] TC-7 (real browser): the Epics block of the board page renders.
- [ ] TC-8: two sessions writing different children at once never conflict on the epic (true by construction; no separate race test written).
