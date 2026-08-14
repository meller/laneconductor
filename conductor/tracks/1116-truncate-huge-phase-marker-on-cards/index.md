# Track 1116: Truncate huge Phase marker on Kanban cards

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Quality gate PASSED — done
**Type**: dev
**Waiting for reply**: no
**Summary**: Lane-view cards were rendering full-paragraph `**Phase**` markers (agents were writing session recaps into it instead of a short label), blowing up card height. Truncated in TrackCard.jsx (list…

## Problem

The Kanban lane-view cards (`TrackCard.jsx`) render `track.current_phase`
next to the progress bar with no truncation at all. Some tracks' `index.md`
had an agent write a full paragraph-length session recap into the
`**Phase**:` marker instead of a short label (e.g. track 1114:
"Phases 1-9 implemented and live-verified. This track surfaced far more
real, pre-existing bugs than originally scoped for — ..." — several
hundred characters). That flowed straight through `parseCurrentPhaseMarker`
in `conductor/laneconductor.sync.mjs`, which — unlike `**Summary**` — had no
length cap (`parseSummaryMarker` already calls `truncateSummary()`; the
Phase marker's parallel function never did), so the card wrapped across many
lines and blew up in height in the lane list view.

## Solution

1. **Display-layer fix** — `TrackCard.jsx`'s phase line: added
   `truncate min-w-0` (single-line CSS ellipsis) with the full text kept in
   a `title` tooltip on hover. Verified live: `clientHeight === scrollHeight`
   (16px, one line), full text still in `title`. The zoomed-in detail view
   (`TrackDetailPanel.jsx`) already rendered `current_phase` untruncated —
   left as-is, so full detail is still available there.
2. **Source-layer fix** — `parseCurrentPhaseMarker()` in
   `conductor/laneconductor.sync.mjs` now runs the parsed value through the
   same `truncateSummary()` (200 chars, word-boundary cut + ellipsis)
   already used for `**Summary**`, so the DB-stored `content_summary` phase
   text is capped at the source too, not just hidden by CSS.

## Phases
- [x] Phase 1: Truncate `current_phase` display in `TrackCard.jsx` (lane view), verified live via computed-style check in browser
- [x] Phase 2: Cap `**Phase**` marker length in `parseCurrentPhaseMarker` (`conductor/laneconductor.sync.mjs`) to match `**Summary**`'s existing 200-char cap

## Related tracks
- [1114](../1114-worktrees-panel-deep-link-autopilot-cleanup/index.md) — the track whose index.md's oversized `**Phase**` marker surfaced this bug live
