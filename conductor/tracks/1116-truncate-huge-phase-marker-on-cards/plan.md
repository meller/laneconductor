# Track 1116: Truncate huge Phase marker on Kanban cards

## Phase 1: Truncate display in TrackCard.jsx (list/lane view)

**Problem**: `track.current_phase` rendered with no truncation in the lane-view card, so an oversized `**Phase**` marker (e.g. track 1114's paragraph-length recap) wrapped across many lines and blew up card height.
**Solution**: Add `truncate min-w-0` to the phase `<span>`, plus a `title` tooltip carrying the full text. Detail view (`TrackDetailPanel.jsx`) already showed it in full — left untouched.

- [x] Task 1: Add single-line CSS truncation + `title` tooltip to the phase span in `ui/src/components/TrackCard.jsx`
- [x] Task 2: Verify live in browser — computed style shows `whiteSpace: nowrap`, `textOverflow: ellipsis`, `clientHeight === scrollHeight`; confirmed `TrackDetailPanel` still renders the untruncated text

**Impact**: Lane-view cards no longer balloon in height from an oversized Phase marker; full text remains one hover (list) or one click (detail panel) away.

## Phase 2: Cap Phase marker length at the source (sync worker)

**Problem**: `parseCurrentPhaseMarker()` in `conductor/laneconductor.sync.mjs` had no length cap, unlike `parseSummaryMarker()` which already truncates via `truncateSummary()`. The oversized text was therefore also stored verbatim in the DB's `content_summary`/phase-equivalent field, not just displayed — the CSS fix alone was a display-layer band-aid.
**Solution**: Route the parsed marker value through the existing `truncateSummary()` helper (200 chars, word-boundary cut + ellipsis), matching Summary's behavior.

- [x] Task 1: Apply `truncateSummary()` to the return value of `parseCurrentPhaseMarker()`
- [x] Task 2: `node --check` syntax verification; confirmed no existing tests reference `parseCurrentPhaseMarker`/`current_phase` truncation behavior (none broken)

**Impact**: Future oversized `**Phase**` markers are capped where they're parsed, not just hidden by CSS — defense in depth alongside the display-layer fix.

## ✅ QUALITY PASSED
