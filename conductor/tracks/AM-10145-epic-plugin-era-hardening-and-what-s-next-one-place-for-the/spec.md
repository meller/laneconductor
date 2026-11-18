# Spec: Epic: plugin-era hardening and "what's next" (one place for the order, the gaps and the notes)

## Problem Statement

Owner idea (2026-11-18): keep the gaps, the order and the small notes of the plugin-era work in ONE index track, so nobody has to open every track to see the picture. Concern raised: if the index track is updated all the time, parallel work will race on it.

## Requirements

- REQ-1 `Part Of` marker: a track may carry the optional marker `**Part Of**: <epic number>` (bare number or `AM-100` form). A track cannot be part of itself; a bad value is ignored. The optional `**Priority**` marker (`high`, `normal`, `low`) is parsed too. Both appear in the track row only when set and valid; the summary table (tracks-summary.md) is deliberately unchanged.
- REQ-2 Derived epic table: `list_tracks`, `get_track` and the board compute the epic's status table from the children's own index.md: children by number with lane, lane status, progress, waiting, `blocked_by`, and a line "N of M children done:success". It is never hand-written and never stored.
- REQ-3 No lost update: a child finishing, or any child edit, never edits the epic file; the epic is read like any track and its static text is written only by its owner, conflict-checked like any write.
- REQ-4 `next`: the epic is skipped as a candidate (its children are) and gets one derived-progress line ("Epic N: 3 of 8 children done").
- REQ-5 Large epics: `list_tracks` and `get_track` list the first children and say how many more are not listed (the done and total counts still cover every child); the board data has no cap. The envelope bound holds.
- REQ-6 No tool-description text is changed (KC-8).
- REQ-7 The board draws an "Epics" block (text only) from the derived data, and the board data and page data carry `epics` only when one exists.

## Decisions

- 2026-11-18: this epic holds only what changes rarely. Status is never stored here.
- 2026-11-18: small notes go in a section "Notes" in this spec, one dated line each, written with update_track (CONFLICT means re-read and retry; rare writers). conversation.md is NOT used for shared notes because it is gitignored (decision D5) and would not reach other machines. There are no notes yet.
- The summary generator and `next` read the epic like any track, so a new user sees it.
- Design (to confirm in the plan lane, as filed): static part (this spec, edited rarely, conflict-checked like any write): the goal, the order of the work, the dependency list, and for each child one line of "what it fixes / what it needs first". Derived part (never hand-written): each child carries an optional marker `**Part Of**: <epic number>`; `list_tracks`, the board and `next` compute the epic's status table (lane, lane status, progress, waiting) from the children's own index.md, the way tracks-summary.md is generated. A child finishing never edits the epic.
- Open for the owner: the spec asked for tests with parallel writers on the epic. The implementation never writes the epic from a child, so a byte-identical test covers the claim and no separate race test was written; the owner decides whether a real two-writer race test is still wanted. Also open: a lint for a `Part Of` that names a track that does not exist.

### The children and the order (one line each)

- 10132 permission prompt for the plugin's own files (independent; hits every first run).
- 10133 plugin-only setup (merged 2026-11-18, review: open items README sentence, landing edits, real use).
- 10134 Remote tier decision (brainstorm; independent; includes where the Fiti PLUG demo tracks 10110-10113 go).
- 10139 marker parser (first): 44 of 239 tracks here are unreadable or unwritable, and the summary shows them as errors; everything below reads indexes.
- 10140 Lane as implicit precondition and `done` guard; returns a fresh base on CONFLICT (also reduces race retries on this very epic).
- 10137 transitions follow-up (defaults, stay and stop, Verdict, clear parking markers), then 10138 `max_retries` Attempts marker (needs 10137).
- 10136 parking and resume (ready-to-resume list, Waiting Reason, Depends On gate); 10135 done-lane truth; 10141 stale running claims and human-comment warning. These three feed `next`.
- 10142 worktree single writer (runner reads through the connector); touches the merge guide that 10133 rewrote.
- 10143 create_track sees other branches; duplicate repair.
- 10144 `next` (universal "I do not know how to continue" command; can ship a first version before 10135, 10136 and 10141, then gain their signals).
- 10124 skill advisor (separate epic; `next` and setup point to it).

Gaps found while planning `next` that no track covers yet, to add here as children when decided: an optional `**Priority**` marker to rank candidates; the `**Part Of**` marker and the derived epic table (this track's own deliverable); the tutorial level kept in the personal gitignored settings file.

Deliverable of this track: the spec above kept current, the `**Part Of**` marker parsed, and the derived epic table shown in list_tracks, get_track and the board (tracks-summary.md is deliberately unchanged), tests with parallel writers on the epic (no lost update), and a one-line mention in `next`.

## Data model and API

- index.md markers: `**Part Of**: <epic number>` and `**Priority**: high|normal|low`, both optional, on the child (the epic holds no child status).
- Track row (connector/src/summary.mjs): `part_of`, `priority`, present only when set.
- `connector/src/epics.mjs`: `childrenOf`, `epicTable`, `epicsOf`, pure functions over the rows.
- `list_tracks`: `children_line`, `children` (and `children_more`) on an epic; `part_of` / `priority` on a track that sets them. `get_track` of an epic: `children`. Board data: `epics`. SKILL.md marker table has the `Part Of` row; `ops/next.md` carries the epic rule.

## Acceptance criteria

- [x] `Part Of` and `Priority` parse into the row only when set and valid; a track naming itself or a bad value is unchanged (REQ-1; test code present, not run).
- [x] The derived table lists children by number with lane, status, progress, a done count and `blocked_by`; none for a track without children (REQ-2; test code present, not run).
- [x] `list_tracks` and `get_track` show an epic its children and a child shows `part_of`; reading never writes the epic (REQ-2, REQ-3; test code present, not run).
- [x] A child finishing through `update_track` leaves the epic file byte-identical and the derived table follows (REQ-3; test code present, not run).
- [x] A very large epic is capped with an "N more not listed" note and stays under the envelope cap (REQ-5; test code present, not run).
- [x] The board data and page data carry `epics` only when one exists, and `board-page.html` has an Epics block (REQ-7; code present, not run).
- [x] `next` skips an epic as a candidate and reports its derived progress (REQ-4; ops/next.md text and fixture F32 present, not run).
- [x] SKILL.md documents `Part Of` (plugins/laneconductor/skills/laneconductor/SKILL.md).
- [ ] The Epics block of the board page renders in a real browser: not verified (human check).
- [ ] A lint for a `Part Of` that names a missing track: not built.
- [ ] A real two-writer race test on the epic: not written; owner decides.
- [ ] Full `npm test` green and strict validate on all three plugins: not verified (connector dependencies are not installed in this checkout).

## Risks and limits

- The epic's own text (the order, the children lines, the Notes) is the owner's content and goes stale if nobody keeps it current; the derived table does not.
- A `Part Of` naming a missing track is not flagged.
- `list_tracks` and `get_track` show only the first children of a very large epic (the done and total counts are complete).

## Out of scope

- Storing any child status in the epic or editing the epic when a child finishes.
- Using conversation.md for shared notes (gitignored, decision D5).
- Changing the tracks-summary.md table.
