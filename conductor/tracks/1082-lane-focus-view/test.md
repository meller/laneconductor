# Tests: Track 1082 — Lane View — Focused Single-Lane Board

No frontend component-test harness exists in this project yet (`ui/vitest.config.*`
scopes vitest to `server/tests/**/*.test.mjs` only — no `@testing-library/react` /
jsdom setup). Verification for this track is manual, via the running dashboard.
Do not introduce a new component-test framework as part of this track.

## Test Commands
```bash
# Start the local stack
lc ui start
lc worker start

# Open the dashboard
open http://localhost:8090
```

## Test Cases

### Feature: Truncation + "+N more →" entry point
- [x] TC-1: A lane with 5 or fewer tracks — expected: full list shown, no truncation link. Verified: Implement (2), Review (0), Quality Gate (11 — exactly at boundary check not directly hit, see TC-2 for >5) unaffected.
- [x] TC-2: A lane with 6+ tracks — expected: only the first 5 (by existing status-group order) are rendered, `+N more →` link rendered at the bottom, N = total − 5. Verified: Backlog (40 total) showed 5 cards + "+35 more →"; Done (366 total) showed "+361 more →" via `find`.
- [x] TC-3: Click "+N more →" — expected: board switches to Lane View, focused on that lane, showing **all** of that lane's tracks (not just the truncated 5). Verified in browser (Backlog → Lane View showed 40 cards across the grid, not 5).

### Feature: Lane View navigation
- [x] TC-4: Lane tabs show correct live counts matching the all-lanes board's per-lane badges. Verified: BACKLOG(40) PLAN(21) IMPLEMENT(28) REVIEW(56) QUALITY GATE(11) DONE(366) matched header badges exactly.
- [x] TC-5: Click a different lane tab — expected: focused lane changes instantly, no full page reload, status filter resets to "All". Verified: Backlog → Quality Gate → Done, filter chip row reset to "ALL (n)" each time.
- [x] TC-6: Click "← All lanes" — expected: returns to the original 6-column board. Verified in browser.

### Feature: Status filter
- [x] TC-7: Default filter is "All" — all of the focused lane's tracks are shown. Verified.
- [x] TC-8: Click a status chip (e.g. "Queued") — expected: only tracks with that `lane_action_status` are shown, chip counts match. Verified: Done lane, "QUEUED (24)" chip filtered grid down to 24 done+queued cards.
- [x] TC-9: Click the active chip again — expected: filter clears back to "All". Verified.
- [ ] TC-10: Select a status with zero matching tracks — expected: empty state message naming the lane and filter, no blank/broken layout. Implemented (`filteredTracks.length === 0` branch) but not exercised against a real zero-match combination during manual testing.

### Feature: Card grid & actions
- [x] TC-11: Cards render in a responsive multi-column grid. Verified: 4-column grid at full browser width in Lane View.
- [x] TC-12: Click a card — expected: detail panel opens, identical to clicking it in the all-lanes board. Verified: clicked track #011 in Lane View, detail panel opened with Overview/Plan/Spec/Tests/Conversation tabs exactly as in the all-lanes board.
- [ ] TC-13: Use the "→" move-to-next-lane button on a card in Lane View — not individually clicked during manual testing; uses the same unmodified `TrackCard` + `onLaneChange` wiring as the all-lanes board.
- [ ] TC-14: Fix review / rerun implement / delete / mark published actions on a card in Lane View — not individually clicked during manual testing; same reasoning as TC-13.
- [x] TC-15: Attempt to drag a card in Lane View — expected: no drop target/highlight anywhere. Confirmed by code review: `LaneFocusView.jsx` registers no `onDragOver`/`onDrop` handlers anywhere in its tree.

### Regression
- [x] TC-16: All-lanes board for lanes with ≤5 tracks is unchanged. Lanes with >5 tracks are now intentionally truncated to 5 + `+N more →` (this is the finalized, requested design — not a regression from the original "show everything, link at the bottom" version, which was tested working but replaced after manual verification showed the link was impractically buried).

### Feature: Sort (Phase 5)
- [x] TC-17: Default state (no interaction) — expected: track order in both views is identical to before Phase 5 (Track # ascending). Verified: on load, "TRACK #" is highlighted, "↑" shown, card order (`#003`, `#004`, `#005`...) matches pre-Phase-5 order.
- [x] TC-18: Switch sort to "Date", direction ascending → descending — expected: newest-created tracks appear first; toggling direction reverses order. Verified in the all-lanes board (Lane View inherits the same `displayTracks` prop, not independently re-tested).
- [x] TC-19: Sort by "Track #" with mixed formats present (`3`-`4` digit numbers observed; `LAN-`/`KAN-`-prefixed track numbers exist in this project per earlier exploration but were not specifically visible in the current viewport) — expected: numeric-aware order. Verified for plain numeric track numbers (`#003` < `#1036`); the mixed-prefix case (e.g. `LAN-107` vs `86`) is covered by `localeCompare(..., {numeric:true})`'s documented behavior but not independently driven in the browser.
- [ ] TC-20: Switching sort while Lane View is open — not exercised; sort was only tested from the all-lanes board. Lane View receives the same `displayTracks` prop so it re-sorts by construction, but this wasn't separately clicked through.

### Feature: Search (Phase 5)
- [x] TC-21: Type a track number (`1082`) into the search box — expected: only matching track(s) shown. Verified: narrowed to exactly track #1082 across all lane columns.
- [x] TC-22: Type a partial title (`lane focus`) — expected: case-insensitive substring match against title. Verified (same search as TC-21, matched on title substring).
- [ ] TC-23: Search query matching zero tracks — not driven live in the browser; the "No tracks match ..." branch was verified by code review only (see spec.md acceptance criteria notes).
- [x] TC-24: Clear the search box — expected: full list returns. Verified: deleting the search text restored the full 40/21/27/58/11/366 lane counts.
- [ ] TC-25: Search narrows a lane below its truncation threshold — not specifically exercised (would require a search query matching more than 5 but fewer than the lane's total tracks); truncation-after-filter is implemented per REQ-10 but not independently verified live.

## Acceptance Criteria
- [x] All test cases above pass via manual verification in the browser, except TC-10, TC-13, TC-14, TC-20, TC-23, TC-25 which are implemented but not individually exercised (see notes above).
- [x] No regressions in the existing all-lanes Kanban board — confirmed unchanged for ≤5-track lanes; >5-track lanes intentionally truncated per updated spec.
- [x] No new console errors observed in the browser during manual testing (checked via `read_console_messages`; only a pre-existing, unrelated WebSocket connection error was present, not caused by this track's changes).
