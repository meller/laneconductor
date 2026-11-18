# Track 10145: Epic: plugin-era hardening and "what's next" (one place for the order, the gaps and the notes)

Written during implementation. The epic's own text (the order, the notes) is edited by the owner as the spec says; this plan covers the code deliverable.

## Phase 1: The `Part Of` marker and the derived table

- [x] Task 1.1: Parse the optional `**Part Of**: <epic number>` (bare number or `AM-100` form; a track cannot be part of itself; a bad value is ignored) and the optional `**Priority**` (`high`, `normal`, `low`) into the track row (`connector/src/summary.mjs`), present only when set. The summary table is unchanged.
- [x] Task 1.2: `connector/src/epics.mjs`: `childrenOf`, `epicTable` (children by number with lane, status, progress, waiting, blocked_by, and "N of M children done:success"), `epicsOf`. Pure, derived from the children's own rows; nothing is ever stored in the epic.
- [x] Task 1.3: `list_tracks` shows `children_line` and `children` on an epic and `part_of` / `priority` on a track that sets them; `get_track` of an epic returns `children`. No tool-description text changed (KC-8).
- [x] Task 1.4: The board data carries `epics` (derived, only when one exists); the page data carries the compact form; `board-page.html` draws an "Epics" block (text only).
- [x] Task 1.5: `SKILL.md` marker table has the `Part Of` row; `ops/next.md` skips an epic as a candidate and adds one derived-progress line (the reference classifier and fixture F32 pin it).
- [x] Task 1.6: Tests: `connector/test/epics.test.mjs` (parsing, table, list_tracks and get_track, the epic file never written, a child finishing leaves the epic byte-identical, board and page data).

## Phase 2: Not done

- [ ] Task 2.1: Tests with parallel writers on the epic (the spec's wording): not needed by this design because the epic is never written by a child; the byte-identical test (TC-4) covers the claim. Left open for the owner to decide whether a real two-writer race test is still wanted.
- [ ] Task 2.2: The epic's own spec text (the order, one line per child, a Notes section) is the owner's content to keep current; not touched here.
- [ ] Task 2.3: A lint for a `Part Of` that names a track that does not exist, and the board page drawn in a real browser.
