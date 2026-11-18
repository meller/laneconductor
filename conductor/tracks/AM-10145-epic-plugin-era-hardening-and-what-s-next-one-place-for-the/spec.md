# Spec: Epic: plugin-era hardening and "what's next" (one place for the order, the gaps and the notes)

## Problem Statement

Owner idea (2026-11-18): keep the gaps, the order and the small notes of the plugin-era work in ONE index track, so nobody has to open every track to see the picture. Concern raised: if the index track is updated all the time, parallel work will race on it.

Design (to confirm in the plan lane): this epic holds only what changes rarely. Status is never stored here.
- Static part (this spec, edited rarely, conflict-checked like any write): the goal, the order of the work, the dependency list, and for each child one line of "what it fixes / what it needs first".
- Derived part (never hand-written): each child carries an optional marker `**Part Of**: <epic number>`; `list_tracks`, the board and `next` compute the epic's status table (lane, lane status, progress, waiting) from the children's own index.md, the way tracks-summary.md is generated. A child finishing never edits the epic.
- Small notes: a section "Notes" in this spec, one dated line each, written with update_track (CONFLICT means re-read and retry; rare writers). conversation.md is NOT used for shared notes because it is gitignored (decision D5) and would not reach other machines.
- The summary generator and `next` read the epic like any track, so a new user sees it.

The children and the order (one line each):
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

Deliverable of this track: the spec above kept current, the `**Part Of**` marker parsed and shown (list_tracks, board, summary), the derived table, tests with parallel writers on the epic (no lost update), and a one-line mention in `next`.

## The need

(To be filled in.)

## Who it is for

(To be filled in.)

## Wanted outcome

(To be filled in.)

## Acceptance criteria

(To be filled in.)

## Out of scope

(To be filled in.)
