# Track 1082: Lane View — Focused Single-Lane Board

## Phase 1: Entry point — truncate to 5 + "+N more →" in KanbanBoard.jsx

**Problem**: Long lanes force scrolling inside a narrow column with no way to
see everything at once. (Originally implemented as a link appended *after*
the full list — confirmed hands-on during manual verification that this still
requires scrolling past dozens of cards to reach the link, defeating the
point. Revised to truncate the column itself.)
**Solution**: Cap each lane column to its first 5 tracks (`laneTracks.slice(0,
5)`), still grouped by status sub-group as before but over the truncated set.
When tracks are hidden, render a `+{hiddenCount} more →` link at the bottom of
the column that requests Lane View for that lane via `onExpandLane?.(lane.id)`.

- [x] Add `onExpandLane` prop to `KanbanBoard`
- [x] Slice `laneTracks` to the first `LANE_EXPAND_THRESHOLD` (5) for `visibleTracks`, group *those* by status instead of the full list
- [x] Render `+{hiddenCount} more →` below the status groups, only when `hiddenCount > 0`
- [x] Wire click to `onExpandLane?.(lane.id)`

**Impact**: `KanbanBoard.jsx` gains one new optional prop; lanes with ≤5 tracks are unaffected; lanes with more are now visibly truncated (this is the intended, requested behavior — not a bug).

## Phase 2: View state in App.jsx

**Problem**: Need a place to hold which view mode (board vs. lane) and which
lane is focused, without a route change.
**Solution**: Lift `boardMode` (`'board' | 'lane'`) and `focusedLane` state
into `App.jsx`'s `AppContent` (named `boardMode`, not `viewMode` — that name
was already taken by the existing lanes/workers toggle). Pass
`onExpandLane={handleExpandLane}` into `KanbanBoard`. Conditionally render
`KanbanBoard` (board mode) or the new `LaneFocusView` (lane mode) in place of
each other.

- [x] Add `boardMode`/`focusedLane` state to `App.jsx`
- [x] Pass `onExpandLane` into `KanbanBoard`
- [x] Swap rendering between `KanbanBoard` and `LaneFocusView` based on `boardMode`
- [x] Thread existing callback props (`onTrackClick`, `onLaneChange`, `onFixReview`, `onRerunImplement`, `onDeleteTrack`, `onMarkPublished`) to both

**Impact**: `App.jsx` owns the view-mode switch; no persistence, resets on refresh. Only the primary local dashboard (`AppContent`, the live component behind the default export) was wired — `CloudAppInner` in the same file is dead code (not referenced anywhere), so it was left untouched.

## Phase 3: LaneFocusView component

**Problem**: Need the actual focused-lane UI: lane tabs, status filter, and a
wide card grid.
**Solution**: New `ui/src/components/LaneFocusView.jsx`.

- [x] Top bar: `← All lanes` button (calls `onBackToBoard`) + lane tabs/pills for all 6 `LANES` with live counts, focused one highlighted; clicking a tab updates `focusedLane` in place
- [x] Exported `LANES` and `LANE_STATUS_CONFIG` from `KanbanBoard.jsx` and imported them in `LaneFocusView.jsx` instead of duplicating, so labels/colors/emoji stay in sync
- [x] Status filter chip row: `All` + one chip per status with counts scoped to the focused lane's tracks; single-select, click active chip (or `All`) to clear
- [x] Card grid: responsive `grid-cols-2 md:grid-cols-3 xl:grid-cols-4` of `TrackCard`s for the focused lane's filtered tracks, passing through all the same callback props `KanbanBoard` already passes to `TrackCard`
- [x] Empty state when the filtered set is empty, naming the lane + active filter

**Impact**: New, self-contained component; no changes to `TrackCard.jsx` needed since it's reused as-is.

## Phase 4: Polish & edge cases

- [x] Switching lanes via tabs resets the active status filter back to `All` (`useEffect` on `focusedLane`) — verified in browser
- [x] Deleting/moving the last track out of a filtered view collapses to the empty-state branch (`filteredTracks.length === 0`) — implemented via the same render check as the empty-filter case, not separately exercised
- [x] `+N more →` / truncation recompute from live `tracks` prop on every render — no stale count risk, since `laneTracks`/`visibleTracks`/`hiddenCount` are derived fresh each render, not cached state

## Phase 5: Global sort + search toolbar

**Problem**: With many tracks per lane, there's no way to see the newest
tracks first, or to jump straight to a track by name/number, in either view.
**Solution**: One `BoardToolbar` rendered once in `App.jsx`, above whichever
of `KanbanBoard` / `LaneFocusView` is active. It owns `sortBy` (`'track_number'
| 'date'`), `sortDir` (`'asc' | 'desc'`), and `searchText` state, all lifted
into `AppContent`. A single `useMemo`d `displayTracks` derived from the raw
`tracks` array (search-filtered, then sorted) is what gets passed to both
`KanbanBoard` and `LaneFocusView` instead of `tracks` directly — so the two
views never sort/filter independently or drift out of sync.

- [x] Add `sortBy`/`sortDir`/`searchText` state to `AppContent` in `App.jsx`, default `sortBy: 'track_number'`, `sortDir: 'asc'` (matches current implicit order), `searchText: ''`
- [x] Write a pure `sortTracks(tracks, sortBy, sortDir)` helper: `track_number` uses `String.prototype.localeCompare(b, undefined, { numeric: true })` (numeric-aware, handles `LAN-107` vs `86` vs `1082`); `date` compares `new Date(a.created_at) - new Date(b.created_at)`; `sortDir === 'desc'` reverses the sorted array
- [x] Write a pure `filterTracksByText(tracks, searchText)` helper: case-insensitive substring match against `title` or `track_number`; empty/whitespace query returns the input unchanged
- [x] Compute `displayTracks = useMemo(() => sortTracks(filterTracksByText(tracks, searchText), sortBy, sortDir), [tracks, searchText, sortBy, sortDir])` in `AppContent`
- [x] New `ui/src/components/BoardToolbar.jsx`: text input (search), a small sort-field toggle (`Track #` / `Date`), and an asc/desc direction button (`↑`/`↓` icon toggling on click)
- [x] Render `<BoardToolbar .../>` once in `AppContent`'s main content area, above the `boardMode === 'lane' ? <LaneFocusView/> : <KanbanBoard/>` switch — not duplicated inside either view
- [x] Pass `displayTracks` (not `tracks`) into both `KanbanBoard` and `LaneFocusView`
- [x] No changes needed inside `KanbanBoard.jsx` or `LaneFocusView.jsx` themselves — REQ-10/REQ-11 fall out for free since both already derive their per-lane/per-status groupings from whatever `tracks` prop they're given, and truncation (`+N more →`) is computed after the incoming array is already sorted/filtered
- [x] Extra (not in original plan, added during implementation): when `searchText` is non-empty and `displayTracks` is empty, render a dedicated "No tracks match ..." message in `AppContent` instead of delegating to `KanbanBoard`/`LaneFocusView` — otherwise `KanbanBoard`'s own `tracks.length === 0` branch would show its "No tracks yet, run newTrack" onboarding message, which is wrong/misleading for a zero-match search on a non-empty project

**Impact**: `App.jsx` gains ~15 lines of state/memo; one new small presentational component; zero changes to `KanbanBoard.jsx`/`LaneFocusView.jsx` logic beyond what prop they receive.

## ✅ COMPLETE

## ✅ REVIEWED

## ✅ QUALITY PASSED
