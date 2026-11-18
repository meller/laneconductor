# Tests: Track 10145 - Epic: plugin-era hardening and "what's next" (one place for the order, the gaps and the notes)

Test command: `cd connector && node --test test/epics.test.mjs test/next.test.mjs` (whole suite: `cd connector && npm test`); `node scripts/build-plugin.mjs --check`.

Tests exist for the ticked cases below (checked by reading the test code and the source; not run when this file was written, the connector dependencies were not installed).

- [x] TC-1 (REQ-1): `Part Of` and `Priority` parse into the row only when set and valid (`epics.test.mjs`).
- [x] TC-2 (REQ-2): the derived table lists children by number with lane, status, progress, a done count and `blocked_by`; none for a track without children.
- [x] TC-3 (REQ-2, REQ-3): `list_tracks` and `get_track` show an epic its children; a child shows `part_of`; reading never edits the epic file or commits.
- [x] TC-4 (REQ-3): a child finishing through `update_track` leaves the epic file byte-identical, and the derived table follows.
- [x] TC-5 (REQ-7): the board data and page data carry `epics` only when one exists.
- [x] TC-6 (REQ-4): `next` skips an epic as a candidate and reports its derived progress (fixture F32 in `connector/test/helpers/next-fixtures.mjs`, run by `next.test.mjs`).
- [ ] TC-7 (REQ-7, real browser): the Epics block of the board page renders. Human check, not done.
- [ ] TC-8 (REQ-3): two sessions writing different children at once never conflict on the epic (true by construction; no separate race test written).
- [x] TC-9 (REQ-5): a very large epic: `epicTable` lists the first children and says how many more, the counts stay complete; `list_tracks` and `get_track` stay under the envelope cap with an N more note (`epics.test.mjs`).
- [x] TC-10 (REQ-2): `get_track` and `create_track` read the rows without asking git which indexes are tracked (`epics.test.mjs`).
