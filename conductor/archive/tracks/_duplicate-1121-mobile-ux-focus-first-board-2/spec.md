# Spec: Track TU-1121 — Mobile UX, focus-first board

## Problem Statement

`app.laneconductor.com` is unusable on a phone. Every claim below was confirmed by
reading the source in this worktree, not inferred:

| # | Location | Defect |
|---|----------|--------|
| 1 | `ui/src/components/KanbanBoard.jsx:74` | `grid grid-cols-6 gap-4` with no responsive variant. At 375px, minus `main`'s `p-6` (48px) and five 16px gaps, each lane is ~41px. Cards are unreadable slivers. |
| 2 | `ui/src/components/TrackCard.jsx:353-354` | Cards move via `draggable` / `onDragStart` (`startDrag`, line 332). HTML5 drag-and-drop emits no events on touch, so a track cannot be moved between lanes on a phone at all. |
| 3 | `ui/src/components/TrackDetailPanel.jsx:700` | Detail panel is `w-full max-w-2xl` (672px) docked right, with an optional `w-96` transcript drawer beside it. Both exceed a 375px viewport. |
| 4 | `ui/src/App.jsx:278, 514, 525` | `px-6` header, `px-6` repo-path strip, `p-6` main. 48px of a 375px viewport spent on horizontal padding before any content renders. |
| 5 | repo-wide | Only 7 of 35 components in `ui/src/components/` carry any responsive treatment. |

`ui/index.html:6` already declares `<meta name="viewport" content="width=device-width,
initial-scale=1.0">`, so the page scales to the device rather than zooming out — which is
precisely why the 6-column grid collapses instead of overflowing.

## Solution

Implement approved design direction B, "focus first". On a phone the job is **monitoring
autonomous agents**, not re-planning: the home screen leads with what is blocked and what is
running, and the board becomes a lane-at-a-time tabbed view. Desktop behaviour is unchanged
at every breakpoint at and above `md` (768px).

**Design authority**: the [Mobile UX canvas](https://claude.ai/code/artifact/7440ac62-4817-47b8-bdf7-679f84970901)
(page 1 = agreed flow; page 2 = rejected structures and why) is the authority on visual
detail. This spec is the authority on behaviour, reuse boundaries and acceptance. Where the
canvas and this spec disagree on pixels, follow the canvas; where they disagree on which
code path runs, follow this spec.

### Three reuse decisions that shape the whole track

Found by reading the existing code. Each removes a component this track would otherwise build
from scratch, and each is a hard requirement, not a suggestion — building a parallel
implementation instead is a review failure.

1. **`ui/src/components/LaneFocusView.jsx` already is the mobile board.** It renders one lane
   at a time with a horizontally scrollable lane rail carrying per-lane counts (lines 46-70), a
   status filter, and the same `TrackCard`s. `App.jsx` already drives it through
   `boardMode === 'lane'` + `focusedLane` state (lines 117, 187-190, 574-590). Phase 2 forces
   `boardMode` to `lane` below `md` and adds swipe — it does **not** write a new mobile board
   component.
2. **`handleLaneChange(track, targetLane)` in `ui/src/App.jsx:182` is the one lane-transition
   path.** It sets `pendingAction`, which opens the existing confirmation modal (line 710).
   Drag-drop calls it; the Phase 3 move sheet calls the same function with the same signature.
   No second transition path, no direct `apiFetch` from the sheet.
3. **`GET /api/inbox` already computes the focus buckets.** `ui/server/index.mjs:1043-1056`
   returns a `bucket` column per row, one of `awaiting_ai` / `needs_input` / `recent_activity`,
   derived from `waiting_for_reply` and the leading ⚠️/❌/✅ of the newest system comment.
   Phase 4 consumes that field. It must **not** re-derive severity client-side; `InboxPanel.jsx`'s
   local `systemSeverity()` helper (line 22) is for a dot colour, not for bucketing.

### Breakpoint contract

Tailwind defaults apply — `ui/tailwind.config.js` extends nothing, so `sm`=640px, `md`=768px,
`lg`=1024px. This track uses exactly one behavioural breakpoint:

- **below `md` (< 768px)** — mobile: bottom tab nav, lane-at-a-time board, tap-to-move sheet,
  full-screen detail sheet, reduced padding.
- **at/above `md` (>= 768px)** — unchanged from today, including the `grid-cols-6` board.

Mobile-only branches are expressed as Tailwind `md:` variants wherever the difference is purely
visual. A `useIsMobile()` hook (new, `ui/src/hooks/useIsMobile.js`, wrapping
`window.matchMedia('(max-width: 767px)')`) is used only where behaviour, not styling, must
differ — which view component mounts, and whether the move sheet is reachable. Two sources of
truth for "is mobile" is a bug; the hook's query and the `md` breakpoint must stay in sync, and
the hook file must carry a comment saying so.

## Requirements

### Phase 1 — mobile app shell
- **REQ-1**: Below `md`, a fixed bottom tab bar renders with four tabs: **Focus**, **Board**,
  **Workers**, **More**. Each tab is at least 44×44 CSS px. It is hidden at `md` and above.
- **REQ-2**: The tabs map onto the existing `viewMode` state in `App.jsx` (values today:
  `projects`, `lanes`, `workers`, `cicd`, `worktrees`) plus the new Focus screen. **More** opens
  a sheet listing Projects, CI/CD, Worktrees, Inbox and Account, each setting `viewMode` (or
  opening the matching panel) exactly as the desktop header buttons do.
- **REQ-3**: The header collapses below `md` to logo + project selector + a single overflow
  control. Every remaining interactive header element has a >= 44px touch target. The existing
  `hidden md:block` / `hidden sm:block` treatments on the wordmark and tagline are kept.
- **REQ-4**: Mobile padding scale — `main`'s `p-6` becomes `p-3 md:p-6`; the header's `px-6`
  becomes `px-3 md:px-6`; the repo-path strip's `px-6` becomes `px-3 md:px-6`. Content bottom
  padding clears the tab bar so the last card is never trapped behind it.

### Phase 2 — lane-at-a-time board
- **REQ-5**: Below `md`, the board renders `LaneFocusView`, never `KanbanBoard`'s
  `grid-cols-6`. At `md` and above, board/lane selection continues to follow the user's own
  `boardMode` choice.
- **REQ-6**: The lane rail scrolls horizontally, shows all six lanes from `LANES`
  (`KanbanBoard.jsx:4-11`) with live per-lane counts, and marks the focused lane. The focused
  lane's chip is scrolled into view when the lane changes.
- **REQ-7**: Horizontal swipe on the card area moves to the previous/next lane in `LANES`
  order. Swipe is bounded — it does not wrap past `backlog` or `done`. Vertical scrolling
  must remain unimpeded: a gesture is treated as a lane swipe only when horizontal travel
  clearly dominates vertical travel and exceeds a minimum distance.
- **REQ-8**: A pinned position indicator shows which of the six lanes is focused, visible
  without scrolling the rail.
- **REQ-9**: `LaneFocusView`'s "← All lanes" control is hidden below `md`, because there is no
  all-lanes grid to return to on mobile.

### Phase 3 — tap-to-move
- **REQ-10**: Below `md`, each `TrackCard` exposes a move affordance that opens a "Move to
  lane" bottom sheet listing the six lanes, with the current lane marked and non-selectable.
- **REQ-11**: Choosing a lane calls `onLaneChange(track, targetLane)` — the identical prop
  drag-drop uses (`KanbanBoard.jsx:54`) — so the existing confirmation modal and API call run
  unchanged.
- **REQ-12**: The sheet enforces the same guard `KanbanBoard.handleDrop` applies
  (`KanbanBoard.jsx:50-53`): a track in lane `plan` with `lane_action_status === 'running'`
  cannot be moved, and the sheet says why rather than silently no-op'ing.
- **REQ-13**: The sheet is dismissible by backdrop tap and by a close control. Opening it must
  not also fire the card's `onClick` (which opens the detail panel).
- **REQ-14**: `draggable` / `onDragStart` stay on the card for desktop. Touch gets an
  additional path, not a replacement of the desktop one.

### Phase 4 — focus screen
- **REQ-15**: A new Focus screen is the default view below `md` on first load for a project.
- **REQ-16**: It renders three sections, in this order: **Needs your input** (rows whose
  `bucket` is `needs_input` or `awaiting_ai`), **Running now** (tracks with
  `lane_action_status === 'running'`), and a **pipeline summary** (count per lane, from the
  same `tracks` array the board uses).
- **REQ-17**: "Needs your input" is populated from `GET /api/inbox`'s `bucket` field. Empty
  state reads as reassurance ("Nothing needs you right now"), not as an error.
- **REQ-18**: Tapping a Focus row opens that track's detail sheet on its conversation tab —
  the same behaviour `handleInboxSelect` already gives the Inbox (`App.jsx:177-180`).
- **REQ-19**: Tapping a pipeline-summary lane switches to the Board tab focused on that lane.

### Phase 5 — full-screen track detail
- **REQ-20**: Below `md`, `TrackDetailPanel` renders as a full-screen sheet (`inset-0`), not a
  `max-w-2xl` right-docked panel. At `md` and above it is unchanged.
- **REQ-21**: The sheet has a visible close control >= 44px, reachable without scrolling.
- **REQ-22**: The transcript drawer (`w-96`, `TrackDetailPanel.jsx:683`) does not render
  side-by-side below `md`. It becomes a switchable full-width view within the sheet.
- **REQ-23**: Tabs inside the panel remain reachable on a narrow viewport — they scroll
  horizontally rather than wrapping into an unusable stack.

### Phase 6 — verification at a real phone viewport
- **REQ-24**: `ui/playwright.config.js` gains a second project, `mobile-chrome`, using
  `devices['Pixel 5']`. The existing `chromium` project and its two specs
  (`app-creator-wizard.spec.js`, `track-10049-connections.spec.js`) keep passing unchanged.
- **REQ-25**: A mobile spec drives, against a mocked API (`page.route()`, the pattern the
  existing specs already use — no live Express or Postgres): Focus screen loads → Board tab →
  swipe between lanes → open move sheet → pick a lane → confirm → detail sheet opens
  full-screen and closes.
- **REQ-26**: A no-horizontal-overflow assertion at 375px:
  `document.documentElement.scrollWidth <= window.innerWidth` on the Focus, Board, and detail
  views.
- **REQ-27**: A manual pass on a real phone against `app.laneconductor.com`, with the
  observed result recorded in `conversation.md`. See the deployment note below.

## Acceptance Criteria

Each is a user-visible outcome, observable by driving the app.

- [ ] AC-1: At a 375×812 viewport, the board shows **one full-width lane** with legible track
      cards. No horizontal page scrollbar appears on any of Focus, Board, or an open track
      detail.
- [ ] AC-2: At 375px, swiping left on the board advances to the next lane and swiping right
      returns to the previous one, and vertical scrolling through a long lane still works.
- [ ] AC-3: At 375px, a user can move a track from one lane to another entirely by tapping:
      open the move sheet, pick a lane, confirm, and the card appears in the destination lane
      after the next refresh. Verified against a real API response, not a mocked one, at least
      once during quality-gate.
- [ ] AC-4: At 375px, a track in `plan` with `lane_action_status === 'running'` cannot be
      moved via the sheet, and the sheet states the reason.
- [ ] AC-5: At 375px, opening a track fills the screen, and its close control returns to the
      previous view without leaving a scroll-locked body.
- [ ] AC-6: At 375px, the Focus screen lists every track the Inbox classifies as needing input,
      and tapping one opens that track's conversation.
- [ ] AC-7: All four bottom tabs are reachable and switch views; each measures >= 44px in both
      dimensions.
- [ ] AC-8: At a 1440×900 viewport, the board still renders all six lanes as a grid, drag-drop
      still moves a card, and the detail panel is still the right-docked `max-w-2xl` panel.
      Screenshot evidence recorded.
- [ ] AC-9: `cd ui && npm test` passes, including the existing
      `KanbanBoard.test.jsx`, `TrackCard.*.test.jsx` and `TrackDetailPanel.test.jsx` suites,
      with no test deleted or weakened to accommodate this track.
- [ ] AC-10: `cd ui && npm run test:e2e` passes for both the `chromium` and `mobile-chrome`
      projects.
- [ ] AC-11: `cd ui && npm run build` succeeds.

## Non-goals

Explicitly out of scope. None of these may be claimed as satisfied, and none blocks this
track from reaching `done` — they were never in it.

- Tablet-specific layout between `md` and `lg`. Tablets get the desktop layout.
- Making `ProjectsPage`, `CICDView`, `WorktreesPanel`, `WorkflowGraph` or the wizard flows
  fully mobile-responsive. They stay reachable via **More** and are allowed to look cramped.
  Item 5 of the Problem table (28 non-responsive components) is *characterised* by this track,
  not fully *resolved* by it.
- Offline support, PWA install, or push notifications.
- Any change to the sync worker, the lane-transition API, or the `/api/inbox` SQL.
- Reordering tracks within a lane by touch.

## API contracts

No new endpoints and no schema change. This track is client-only, plus one Playwright config
addition. Endpoints consumed, all existing:

| Endpoint | Used by | Change |
|----------|---------|--------|
| `GET /api/inbox?project_id=` | Phase 4 Focus screen | none — reads the existing `bucket` field |
| `PATCH`/lane-move path behind `handleLaneChange` | Phase 3 move sheet | none — reached through the existing handler |
| `GET /api/projects/:id/tracks` | Board, Focus pipeline summary | none |

## Deployment note (affects REQ-27 only)

`app.laneconductor.com` is Firebase-Hosting-fronted, and `conductor/product.md` records a live
routing gap (track 10052) where multi-segment API paths silently return the SPA's `index.html`
instead of reaching the Cloud Function. That gap is unrelated to this track and is not this
track's to fix. If it blocks the REQ-27 manual pass, run that pass against a local
`local-api` stack at a 375px viewport instead and record which environment was used.
