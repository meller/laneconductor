# Tests: Track TU-1121 — Mobile UX, focus-first board

## Test Commands

```bash
# Unit / component (Vitest + Testing Library) — run from ui/
cd ui && npm test

# A single suite
cd ui && npm test -- src/components/MoveToLaneSheet.test.jsx

# Browser E2E, both viewports
cd ui && npm run test:e2e

# Mobile project only
cd ui && npx playwright test --project=mobile-chrome

# Desktop regression only
cd ui && npx playwright test --project=chromium

# Production build must still succeed
cd ui && npm run build
```

**Viewport convention**: mobile assertions are made at **375×812**; desktop regression
assertions at **1440×900**. In Vitest, viewport is simulated by stubbing
`window.matchMedia` for `useIsMobile`; in Playwright it is the real `Pixel 5` / `Desktop
Chrome` device.

**Mock convention for E2E**: `page.route()` at the network layer, matching
`ui/e2e/app-creator-wizard.spec.js` and `ui/e2e/track-10049-connections.spec.js`. No live
Express server, no Postgres.

---

## Test Cases

### Phase 1 — mobile app shell

- [ ] TC-1.1: `useIsMobile` returns `true` when `matchMedia('(max-width: 767px)')` matches —
      expected: `true`, and `false` at 768px.
- [ ] TC-1.2: `useIsMobile` updates on a `change` event from the media query list — expected:
      re-render with the new value, and the listener is removed on unmount.
- [ ] TC-1.3: `MobileTabBar` renders exactly four tabs labelled Focus, Board, Workers, More —
      expected: four buttons, in that order.
- [ ] TC-1.4: Each tab's computed box is at least 44×44 CSS px — expected: verified in the
      Playwright mobile spec via `boundingBox()`, since jsdom does not compute layout.
- [ ] TC-1.5: Clicking a tab calls `onSelect` with that tab's id — expected: one call, correct
      id, no view state forked away from `viewMode`.
- [ ] TC-1.6: `MobileTabBar` is not rendered at desktop width — expected: absent from the
      accessibility tree under `Desktop Chrome` (it carries `md:hidden`).
- [ ] TC-1.7: `MobileMoreSheet` lists Projects, CI/CD, Worktrees, Inbox, Account, and each
      entry invokes the same setter the desktop header uses — expected: `setViewMode`/panel
      opener called with the matching value.
- [ ] TC-1.8: `main` has bottom padding clearing the tab bar — expected: at 375px, the last
      track card's bottom edge sits above the tab bar's top edge (Playwright bounding boxes).

### Phase 2 — lane-at-a-time board

- [ ] TC-2.1: At mobile width, `App` renders `LaneFocusView` and not `KanbanBoard`'s
      `grid-cols-6` — expected: no element with class `grid-cols-6` in the document.
- [ ] TC-2.2: At desktop width with `boardMode === 'board'`, `KanbanBoard` still renders six
      lane columns — expected: `grid-cols-6` present, six lane headers.
- [ ] TC-2.3: The lane rail renders all six `LANES` with correct counts — expected: counts
      match `tracks.filter(t => t.lane_status === lane.id).length` for each lane.
- [ ] TC-2.4: `useSwipe` fires `onSwipeLeft` for dx = -80, dy = 10 — expected: called once.
- [ ] TC-2.5: `useSwipe` does **not** fire for dx = -30 (below the 50px minimum) — expected:
      not called.
- [ ] TC-2.6: `useSwipe` does **not** fire for dx = -60, dy = 90 (vertical dominates) —
      expected: not called, so vertical scroll is never hijacked.
- [ ] TC-2.7: Swiping left on the last lane (`done`) does not wrap to `backlog` — expected:
      `focusedLane` stays `done`.
- [ ] TC-2.8: Swiping right on the first lane (`backlog`) does not wrap to `done` — expected:
      `focusedLane` stays `backlog`.
- [ ] TC-2.9: "← All lanes" is hidden at mobile width and present at desktop width —
      expected: absent below `md`, present at/above.
- [ ] TC-2.10: The pinned lane indicator reflects the focused lane after a swipe — expected:
      shows the new lane's position (e.g. "3 / 6") without the rail being scrolled.
- [ ] TC-2.11: A lane with more tracks than fit still scrolls vertically at 375px — expected:
      `scrollTop` changes after a vertical drag.

### Phase 3 — tap-to-move

- [ ] TC-3.1: The move affordance is present on `TrackCard` at mobile width, absent at desktop
      width — expected: `md:hidden` honoured in the Playwright spec under both projects.
- [ ] TC-3.2: Tapping the move affordance opens `MoveToLaneSheet` and does **not** open the
      detail panel — expected: sheet visible, detail panel absent (`stopPropagation` works).
- [ ] TC-3.3: `MoveToLaneSheet` lists all six lanes with the current lane marked and
      non-selectable — expected: current lane's button disabled or inert.
- [ ] TC-3.4: Selecting a lane calls `onLaneChange(track, targetLane)` with the same signature
      drag-drop uses — expected: exactly one call, correct args.
- [ ] TC-3.5: Selecting a lane triggers **no** direct `apiFetch` from the sheet — expected:
      zero network calls attributable to the sheet; the transition goes through
      `handleLaneChange` → `pendingAction` → confirmation modal.
- [ ] TC-3.6: The existing confirmation modal appears after selection — expected: modal text
      naming the source and target lanes.
- [ ] TC-3.7: A track with `lane_status === 'plan'` and `lane_action_status === 'running'`
      cannot be moved and the sheet shows the reason — expected: lanes disabled, reason text
      visible, `onLaneChange` not called.
- [ ] TC-3.8: A `plan` track with `lane_action_status === 'success'` **is** movable —
      expected: `onLaneChange` called (guards on state, not on lane alone).
- [ ] TC-3.9: Backdrop tap closes the sheet — expected: `onClose` called, sheet unmounted.
- [ ] TC-3.10: Desktop drag-drop still moves a card — expected: `KanbanBoard.test.jsx`'s
      existing drag assertions still pass unmodified.

### Phase 4 — focus screen

- [ ] TC-4.1: "Needs your input" lists rows whose `bucket` is `needs_input` — expected: those
      rows present, `recent_activity` rows absent.
- [ ] TC-4.2: `awaiting_ai` rows also appear under "Needs your input" — expected: present.
- [ ] TC-4.3: A `recent_activity` row (leading `✅`) does not appear under "Needs your input" —
      expected: absent.
- [ ] TC-4.4: The component does not re-derive severity from `last_comment_body` — expected: a
      row with `bucket: 'recent_activity'` but a `⚠️`-leading body is still treated as
      recent activity, proving the server's `bucket` is the sole source.
- [ ] TC-4.5: "Running now" lists exactly the tracks with `lane_action_status === 'running'` —
      expected: match by track number.
- [ ] TC-4.6: The pipeline summary shows a count per lane matching the board's counts —
      expected: six rows, counts equal to `LaneFocusView`'s rail counts for the same data.
- [ ] TC-4.7: Tapping a pipeline lane row switches to the Board tab focused on that lane —
      expected: `LaneFocusView` renders with that `focusedLane`.
- [ ] TC-4.8: Tapping a "Needs your input" row calls `handleInboxSelect` and opens the detail
      panel on the conversation tab — expected: panel open, `initialTab === 'conversation'`.
- [ ] TC-4.9: With no rows in a bucket, the section shows its reassurance empty state —
      expected: "Nothing needs you right now"-style copy, no error styling.
- [ ] TC-4.10: Focus is the default tab at mobile width on first load — expected: Focus
      content rendered without any tab interaction.

### Phase 5 — full-screen track detail

- [ ] TC-5.1: At mobile width the panel container is full-screen — expected: its bounding box
      width equals the viewport width (375px).
- [ ] TC-5.2: At desktop width the panel is still right-docked at `max-w-2xl` — expected:
      width <= 672px, right edge at the viewport's right edge.
- [ ] TC-5.3: The transcript drawer does not render as a side-by-side column at mobile width —
      expected: no second column; the toggle switches the sheet's own content.
- [ ] TC-5.4: Toggling to the transcript and back at mobile width returns to the detail
      content — expected: detail tabs visible again.
- [ ] TC-5.5: The close control is >= 44×44 at mobile width and reachable without scrolling —
      expected: `boundingBox()` within the initial viewport.
- [ ] TC-5.6: Closing restores scrolling of the underlying view — expected: `document.body`
      has no residual `overflow: hidden`.
- [ ] TC-5.7: Panel tabs scroll horizontally rather than wrapping at 375px — expected: the tab
      strip's `scrollWidth > clientWidth` and all tabs reachable by scrolling.
- [ ] TC-5.8: `TrackDetailPanel.test.jsx`'s existing assertions still pass — expected: green,
      unmodified.

### Phase 6 — verification at a real phone viewport

- [ ] TC-6.1: `playwright.config.js` declares both `chromium` and `mobile-chrome` projects —
      expected: `npx playwright test --list` shows specs under both.
- [ ] TC-6.2: Full mobile flow spec passes: Focus → Board → swipe → move sheet → select →
      confirm → detail opens → detail closes — expected: green under `mobile-chrome`.
- [ ] TC-6.3: No horizontal overflow at 375px on the Focus view — expected:
      `document.documentElement.scrollWidth <= window.innerWidth`.
- [ ] TC-6.4: Same assertion on the Board view — expected: no overflow.
- [ ] TC-6.5: Same assertion with a track detail sheet open — expected: no overflow.
- [ ] TC-6.6: `app-creator-wizard.spec.js` passes unchanged under `chromium` — expected: green.
- [ ] TC-6.7: `track-10049-connections.spec.js` passes unchanged under `chromium` — expected:
      green.
- [ ] TC-6.8: `cd ui && npm test` — expected: all suites pass, with no test deleted or
      weakened for this track.
- [ ] TC-6.9: `cd ui && npm run build` — expected: exit 0.
- [ ] TC-6.10: Manual device pass recorded in `conversation.md` — expected: device, viewport,
      environment (`app.laneconductor.com` or local `local-api`) and observed result all
      stated. Required because no automated check can confirm a real touch gesture feels right.

---

## Acceptance Criteria

Mirrors `spec.md`. Ticked only against output actually seen.

- [ ] AC-1: One full-width, legible lane at 375×812, and no horizontal page scrollbar on
      Focus, Board or an open detail sheet.
- [ ] AC-2: Swipe moves between lanes both directions, stops at both ends, and vertical
      scrolling still works.
- [ ] AC-3: A track is moved between lanes entirely by tapping, verified once against a **real
      API** during quality-gate, not only against a mocked one.
- [ ] AC-4: A `plan` + `running` track cannot be moved via the sheet, and the sheet states why.
- [ ] AC-5: Track detail fills the screen and closes cleanly without leaving a scroll lock.
- [ ] AC-6: Focus lists every track the Inbox classifies as needing input; tapping one opens
      its conversation.
- [ ] AC-7: All four bottom tabs reachable, switching views, each >= 44px.
- [ ] AC-8: At 1440×900 the six-lane grid, drag-drop, and the right-docked `max-w-2xl` detail
      panel are all unchanged. Screenshot recorded.
- [ ] AC-9: `cd ui && npm test` passes with no test deleted or weakened.
- [ ] AC-10: `cd ui && npm run test:e2e` passes for both `chromium` and `mobile-chrome`.
- [ ] AC-11: `cd ui && npm run build` succeeds.
