# Tests: Track 1116 — Truncate huge Phase marker on Kanban cards

## Test Commands
```bash
node --check conductor/laneconductor.sync.mjs
```

## Test Cases

### Feature: Lane-view card phase truncation
- [x] TC-1: Card with a paragraph-length `**Phase**` marker (track 1114 live data) renders single-line — verified via computed style (`whiteSpace: nowrap`, `textOverflow: ellipsis`, `clientHeight === scrollHeight`)
- [x] TC-2: Full phase text present in the card's `title` attribute
- [x] TC-3: Track detail panel (opened via card click) still renders the phase text in full, unwrapped, no truncation class

### Feature: Sync worker Phase marker cap
- [x] TC-4: `parseCurrentPhaseMarker()` truncates values over 200 chars via `truncateSummary()`, matching `parseSummaryMarker()`'s existing behavior
- [x] TC-5: `node --check` passes on `conductor/laneconductor.sync.mjs`

## Acceptance Criteria
- [x] No regression to `TrackDetailPanel` phase rendering
- [x] No existing tests reference `parseCurrentPhaseMarker`/phase-truncation behavior (confirmed via grep — none broken)
