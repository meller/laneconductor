# Spec: Lane View — Focused Single-Lane Board

## Problem Statement
`KanbanBoard.jsx` renders all 6 lanes as a fixed `grid-cols-6`, each column
`overflow-y-auto` and further split into status sub-groups (waiting / queued /
running / success / failed). Once a lane has more than ~5 tracks, that narrow
column requires a lot of scrolling to scan, even though most of the horizontal
space on the page belongs to the other 5 (mostly-empty) columns.

Confirmed hands-on while verifying the first version of this track: with a
lane's full list left in place, the "view more" entry point ends up buried
below dozens of cards, requiring exactly the long scroll this track exists to
eliminate. Truncating each lane column to a fixed number of visible cards
removes that scroll entirely.

## Requirements
- REQ-1: Each lane column in the existing all-lanes board shows at most 5
  tracks (grouped by status sub-group as today, in existing order, first 5
  overall across groups). Lanes with 5 or fewer tracks are unaffected — full
  list, no truncation. When a lane has more than 5, a `+N more →` link
  appears at the bottom of the column, where N is the count of tracks hidden
  by the truncation (not the lane's total).
- REQ-2: Clicking `+N more →` switches the page into **Lane View**, focused
  on that lane. Lane View state (`boardMode: 'board' | 'lane'`, `focusedLane`)
  lives in `App.jsx` and is passed down as props — no route/URL change, no
  persistence (a refresh resets to the all-lanes board).
- REQ-3: Lane View shows a top bar with all 6 lanes as tabs/pills (with live
  counts), the focused lane highlighted, plus a `← All lanes` control that
  returns to `boardMode: 'board'`. Clicking a different tab reassigns
  `focusedLane` without leaving Lane View.
- REQ-4: Lane View shows a single-select status filter chip row scoped to the
  focused lane: `All | ⌛ Waiting (n) | ⏳ Queued (n) | 🔄 Running (n) |
  ✅ Success (n) | ❌ Failed (n)`, counts and emoji/labels matching
  `KanbanBoard.jsx`'s existing `statusConfig`. Default is `All`. Clicking a
  chip filters to only that status; clicking it again (or clicking `All`)
  clears the filter back to showing everything.
- REQ-5: The focused lane's (filtered) tracks render as `TrackCard`s in a
  responsive multi-column grid (e.g. 2 cols on small screens up to 4 on wide
  screens) instead of the narrow single-column stack used in the all-lanes
  board.
- REQ-6: If the filtered set is empty (e.g. "Failed" selected but nothing is
  failed), show an empty state message naming the lane and active filter
  (e.g. "No queued tracks in Implement").
- REQ-7: Lane View is not a drag-and-drop target. Lane changes for a card use
  the existing non-drag controls already on `TrackCard` (the "→ move to next
  lane" button and the detail panel opened on click) — both continue to work
  unmodified inside the new grid.
- REQ-8: All existing `KanbanBoard` callback props (`onTrackClick`,
  `onLaneChange`, `onFixReview`, `onRerunImplement`, `onDeleteTrack`,
  `onMarkPublished`) must be threaded through to `TrackCard`s rendered inside
  Lane View, unchanged in behavior from the all-lanes board.
- REQ-9: A single global toolbar, rendered once above the board (covering
  both the all-lanes board and Lane View — not duplicated per lane/column),
  provides:
  - A sort control choosing between `Track #` and `Date` as the sort key,
    plus an asc/desc direction toggle. Default is `Track #` ascending,
    matching today's implicit order (the API's `ORDER BY t.track_number`) —
    so with no interaction, nothing about existing card order changes.
  - `Date` sorts by `created_at` (when the track was created), not
    `content_updated_at`.
  - `Track #` sort is numeric-aware (e.g. `#2` sorts before `#10`), not a
    plain lexicographic string sort, since `track_number` is stored as TEXT
    and includes non-numeric formats (e.g. `LAN-107`).
  - A text search box that filters tracks whose `title` or `track_number`
    contains the (case-insensitive) query. Empty query shows all tracks.
- REQ-10: Sort and search apply identically to both the all-lanes board and
  Lane View — same underlying filtered/sorted track list is passed to
  whichever is rendered. In the all-lanes board, the existing "keep first 5,
  `+N more →`" truncation (REQ-1) is computed *after* sort/search, so e.g.
  sorting by "Date desc" surfaces the newest tracks within each lane's
  visible 5, and a search query narrows what's counted for truncation too.
- REQ-11: Lane View's own per-lane tabs, status filter chips, and empty
  state continue to work unchanged, but now operate over the
  globally-sorted/searched set rather than the raw `tracks` array.

## Acceptance Criteria
- [x] A lane with 6+ tracks is truncated to its first 5 (by existing status-group order) and shows `+N more →`; a lane with 5 or fewer shows its full list and no link.
- [x] Clicking `+N more →` opens Lane View focused on that lane, full width, showing all of that lane's tracks (not just the truncated 5).
- [x] Lane tabs show correct live counts and switching tabs updates the focused lane instantly (verified in browser: Backlog → Quality Gate → Done, counts matched, filter reset each time).
- [x] `← All lanes` returns to the original 6-column board (verified in browser).
- [x] Status filter chips show correct counts, single-select behavior, and `All` clears the filter (verified: Done lane, Queued (24) chip filtered and toggled off cleanly).
- [x] Cards in Lane View use a responsive multi-column grid, not a single narrow column (verified: 4-column grid in browser at full width).
- [ ] Empty filtered state renders a clear message instead of a blank area. (implemented; not exercised against a real zero-match filter during manual testing)
- [x] Click-to-open-detail works identically inside Lane View (verified in browser). Move-to-next-lane / fix review / rerun implement / delete / mark published were not individually clicked during manual testing, but use the exact same `TrackCard` component and prop wiring as the all-lanes board.
- [x] No drag-and-drop targets are rendered in Lane View (no `onDragOver`/`onDrop` handlers exist in `LaneFocusView.jsx`).
- [x] All-lanes board (`KanbanBoard.jsx`) is unchanged for lanes with 5 or fewer tracks; lanes with more than 5 are now truncated to 5 with a `+N more →` link (this is an intentional, requested change to REQ-1, not a regression).
- [x] Default sort (no interaction) matches the pre-Phase-5 order — verified: card order unchanged from before Phase 5 on load.
- [x] Track # sort is numeric-aware (verified in browser: `#003`/`#004`/`#005`/.../`#1036`/... ascending, not lexicographic).
- [x] Date sort (desc) surfaces the newest-created tracks first — verified: track #1082 (created during this session) appeared at the top of Implement; #1081, #1078 near the top of their lanes.
- [x] Search filters by title/track number, case-insensitive, across all lanes at once — verified: "lane focus" narrowed the entire board to exactly track #1082.
- [x] Zero-match search shows a dedicated "No tracks match ..." message rather than the misleading "no tracks yet, run newTrack" onboarding message (implemented; the exact zero-match render path was verified by code review of the added ternary in `App.jsx`, not by driving a live zero-match search in the browser).
- [x] Clearing the search box restores the full list (verified in browser).

## API Contracts / Data Models
None — this is a client-only UI change. No new endpoints, no schema changes.
`viewMode` / `focusedLane` are ephemeral React state in `App.jsx`, not persisted.
