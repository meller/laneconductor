# Track TU-1121: Mobile UX — focus-first board

Six phases, ordered so each one is independently verifiable at a 375px viewport. Phases 1-2
are the ones that make the app *usable*; 3-5 make it *complete*; 6 proves it.

Commit per phase: `feat(track-1121): Phase N - <description>`.

**Standing constraint for every phase**: desktop (>= `md`, 768px) behaviour must not change.
After each phase, check the board at 1440px before committing — a `md:` variant left off one
class silently breaks the desktop grid, and the existing Vitest suites will not always catch
it.

---

## Phase 1: Mobile app shell

**Problem**: `App.jsx` has one layout. The header packs six controls into a `px-6` flex row,
`main` burns 48px on `p-6`, and there is no navigation affordance sized for a thumb.

**Solution**: A bottom tab bar below `md` driving the existing `viewMode` state, a header that
collapses, and a mobile padding scale. No new routing — `viewMode` already carries the whole
navigation model.

- [x] Task 1.1: Add `ui/src/hooks/useIsMobile.js` — `window.matchMedia('(max-width: 767px)')`
      with a `change` listener and SSR-safe initial value. Comment it to state that 767px must
      stay in lockstep with Tailwind's `md` breakpoint, since the two together are the only
      definition of "mobile" in this codebase.
- [x] Task 1.2: Add `ui/src/components/MobileTabBar.jsx` — `fixed bottom-0 inset-x-0 z-30
      md:hidden`, four tabs (Focus / Board / Workers / More), each `min-h-11 min-w-11`
      (44px), active tab visually marked. Props: `active`, `onSelect`.
- [x] Task 1.3: Add `ui/src/components/MobileMoreSheet.jsx` — bottom sheet listing Projects,
      CI/CD, Worktrees, Inbox, Account. Each entry calls the same setter the desktop header
      button calls, so there is one navigation path per destination, not two.
- [x] Task 1.4: Wire both into `App.jsx`. Introduce a `mobileTab` state (`focus` | `board` |
      `workers` | `more`) that derives from and writes to the existing `viewMode`; do not fork
      view state. Render the tab bar only when a project is selected, matching the existing
      gating on the desktop view-mode switcher.
- [x] Task 1.5: Padding scale in `App.jsx` — `p-6` → `p-3 md:p-6` on `main` (line 525),
      `px-6` → `px-3 md:px-6` on the header (line 278) and the repo-path strip (line 514).
      Add `pb-20 md:pb-6` to `main` so the last card clears the fixed tab bar.
- [x] Task 1.6: Header collapse — hide the New Track / Bug / New Project button cluster below
      `md` (they move into the More sheet), and raise the remaining controls to 44px targets.

**Impact**: `ui/src/App.jsx`, new `ui/src/hooks/useIsMobile.js`,
`ui/src/components/MobileTabBar.jsx`, `ui/src/components/MobileMoreSheet.jsx`.

**Verify before ticking**: at 375px the four tabs are visible and switch views, nothing is
trapped under the tab bar, and at 1440px the header and board are pixel-unchanged.

---

## Phase 2: Lane-at-a-time board

**Problem**: `KanbanBoard.jsx:74` is `grid grid-cols-6` with no responsive variant — ~41px
lanes at 375px.

**Solution**: Reuse `LaneFocusView`, which already renders exactly this. Force it below `md`
and add swipe. **Do not write a new mobile board component** — this phase is mostly wiring.

- [ ] Task 2.1: In `App.jsx`, force the mobile branch: below `md`, render `LaneFocusView`
      regardless of `boardMode`; at/above `md`, keep the existing `boardMode === 'lane'`
      choice. Default `focusedLane` to the first non-empty lane rather than `null`, so the
      mobile board never opens on an empty column.
- [ ] Task 2.2: In `LaneFocusView.jsx`, hide the "← All lanes" button below `md`
      (`hidden md:inline-flex`) — there is no all-lanes grid to go back to on mobile.
- [ ] Task 2.3: Lane rail — confirm it already scrolls (`overflow-x-auto`, line 46) and add
      `scrollIntoView({ inline: 'center' })` on the focused chip when `focusedLane` changes,
      so lanes 5 and 6 are reachable without hunting.
- [ ] Task 2.4: Add a pinned lane-position indicator (six dots, or "3 / 6" plus the lane
      label) that stays visible when the rail is scrolled away.
- [ ] Task 2.5: Swipe — add `ui/src/hooks/useSwipe.js` (touchstart/touchmove/touchend,
      returning handlers). Treat a gesture as a lane swipe only when `|dx| > 50px` **and**
      `|dx| > 1.5 * |dy|`, so vertical scrolling through a long lane is never hijacked.
      Bound at both ends of `LANES` — no wrapping from `done` back to `backlog`.
- [ ] Task 2.6: Apply the swipe handlers to `LaneFocusView`'s card area only, not the whole
      screen, so the lane rail's own horizontal scroll is not fighting the gesture.

**Impact**: `ui/src/App.jsx`, `ui/src/components/LaneFocusView.jsx`, new
`ui/src/hooks/useSwipe.js`. `KanbanBoard.jsx` gains nothing but possibly a `md:` guard.

**Verify before ticking**: at 375px one lane fills the width with legible cards, swiping moves
between lanes in both directions and stops at the ends, and a long lane still scrolls
vertically. At 1440px `grid-cols-6` still renders.

---

## Phase 3: Tap-to-move

**Problem**: `TrackCard.jsx:353` uses `draggable`/`onDragStart`. HTML5 drag-and-drop emits no
events on touch, so moving a track on a phone is impossible.

**Solution**: A "Move to lane" bottom sheet that calls the **same** `onLaneChange(track,
targetLane)` prop drag-drop calls. Additive — the desktop drag path is untouched.

- [ ] Task 3.1: Add `ui/src/components/MoveToLaneSheet.jsx`. Props: `track`, `onSelect(laneId)`,
      `onClose`. Lists all six lanes from `LANES` with the current lane marked and
      non-selectable.
- [ ] Task 3.2: Port the guard from `KanbanBoard.handleDrop` (lines 50-53): a `plan`-lane track
      with `lane_action_status === 'running'` is not movable. The sheet renders every lane
      disabled with a visible reason line, rather than accepting the tap and silently doing
      nothing — the existing drag path only `console.warn`s, which is invisible to a user.
- [ ] Task 3.3: Add a move affordance to `TrackCard` shown only below `md` (`md:hidden`), with
      `onClick` calling `e.stopPropagation()` so it never also opens the detail panel
      (`TrackCard.jsx:355`'s card-level `onClick`).
- [ ] Task 3.4: Wire the sheet's selection to `onLaneChange` in both `LaneFocusView` and
      `KanbanBoard` — `handleLaneChange` in `App.jsx:182` then sets `pendingAction`, and the
      existing confirmation modal (`App.jsx:710`) runs unchanged. No new API call anywhere in
      this phase; if this phase adds an `apiFetch`, it is wrong.
- [ ] Task 3.5: Dismissal — backdrop tap and an explicit close control, both >= 44px.

**Impact**: new `ui/src/components/MoveToLaneSheet.jsx`, `ui/src/components/TrackCard.jsx`,
`ui/src/components/LaneFocusView.jsx`, `ui/src/components/KanbanBoard.jsx`.

**Verify before ticking**: at 375px, move a real track between two lanes end to end and see it
land. Then confirm a `plan`+`running` track shows the disabled state with its reason.

---

## Phase 4: Focus screen

**Problem**: The board is the wrong home screen for a phone. What matters on a phone is what
is blocked and what is running.

**Solution**: A Focus screen reading `GET /api/inbox`'s existing `bucket` classification.

- [ ] Task 4.1: Add `ui/src/components/MobileFocusView.jsx`. Fetch via the existing `useApi`
      hook against `/api/inbox?project_id=<id>` — the same endpoint `InboxPanel` uses.
- [ ] Task 4.2: Section "Needs your input" — rows where `bucket` is `needs_input` or
      `awaiting_ai`. **Use the server's `bucket` field.** Do not re-derive severity from the
      comment body client-side; `ui/server/index.mjs:1049-1056` already does that, and a second
      classifier will drift from it.
- [ ] Task 4.3: Section "Running now" — tracks from the existing `tracks` array with
      `lane_action_status === 'running'`, showing lane, title and progress.
- [ ] Task 4.4: Section "Pipeline" — one row per lane in `LANES` order with its count. Tapping
      a row switches to the Board tab with `focusedLane` set to that lane (REQ-19).
- [ ] Task 4.5: Row tap → `handleInboxSelect(projectId, trackNumber, ...)` (`App.jsx:177`),
      which already opens the detail panel on the conversation tab. Reuse it; do not
      reimplement.
- [ ] Task 4.6: Empty states per section, written as reassurance ("Nothing needs you right
      now"), never as an error.
- [ ] Task 4.7: Make Focus the default mobile tab on first load for a project.

**Impact**: new `ui/src/components/MobileFocusView.jsx`, `ui/src/App.jsx`.

**Verify before ticking**: with a track that has a `⚠️`/`❌` system comment, that track appears
under "Needs your input" and tapping it opens its conversation.

---

## Phase 5: Full-screen track detail

**Problem**: `TrackDetailPanel.jsx:700` is `w-full max-w-2xl` (672px) docked right, with an
optional `w-96` transcript drawer beside it (line 683). Both are wider than 375px.

**Solution**: Below `md`, render the panel `inset-0` full-screen and make the transcript a
switchable view rather than a side-by-side column.

- [ ] Task 5.1: Container — `fixed inset-0` below `md`, `fixed top-0 right-0 h-full` at `md`
      and above. Panel body `w-full max-w-none md:max-w-2xl`.
- [ ] Task 5.2: Transcript drawer — `hidden md:flex` for the side-by-side column; below `md`,
      the existing transcript toggle switches the sheet's own content between detail and
      transcript instead of docking a second column.
- [ ] Task 5.3: Close control >= 44px, pinned at the top of the sheet and reachable without
      scrolling.
- [ ] Task 5.4: Panel tabs get `overflow-x-auto` with non-shrinking items so they scroll rather
      than wrapping into an unusable stack at 375px.
- [ ] Task 5.5: Confirm no body scroll-lock leaks after close — opening and closing the sheet
      must leave the underlying view scrollable.

**Impact**: `ui/src/components/TrackDetailPanel.jsx`.

**Verify before ticking**: at 375px open a track, switch to the transcript and back, close it,
and confirm the board below still scrolls. At 1440px the panel is still right-docked at
`max-w-2xl` with the transcript beside it.

---

## Phase 6: Verification at a real phone viewport

**Problem**: Nothing in the current test setup runs at a phone viewport.
`ui/playwright.config.js` declares one project, `chromium` / `Desktop Chrome`.

**Solution**: A `mobile-chrome` Playwright project and a spec that drives the whole mobile
flow, plus a manual device pass.

- [ ] Task 6.1: Add `{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }` to
      `playwright.config.js`'s `projects`. Leave the `chromium` project, the port-8190
      `webServer` block and `reuseExistingServer: false` exactly as they are — that config
      carries a documented reason (track AM-1119).
- [ ] Task 6.2: Add `ui/e2e/track-1121-mobile.spec.js`, mocking the API with `page.route()` —
      the pattern both existing specs use, so no Express server or Postgres is needed.
- [ ] Task 6.3: Spec coverage — Focus screen renders its three sections; Board tab shows one
      lane; swipe advances the lane; move sheet opens, selects a lane, confirmation appears;
      detail sheet opens full-screen and closes.
- [ ] Task 6.4: Overflow assertion at 375px on Focus, Board and detail:
      `document.documentElement.scrollWidth <= window.innerWidth`.
- [ ] Task 6.5: Desktop regression — run the full suite for both projects and confirm the two
      existing specs still pass under `chromium`.
- [ ] Task 6.6: Run `cd ui && npm test` and `cd ui && npm run build`; paste real output into
      `conversation.md`. No test may be deleted or weakened to make this pass.
- [ ] Task 6.7: Manual pass on a real phone. Record the device, viewport and observed result
      in `conversation.md`. If the track-10052 Firebase Hosting routing gap blocks
      `app.laneconductor.com`, run against a local `local-api` stack instead and say which
      environment was used.

**Impact**: `ui/playwright.config.js`, new `ui/e2e/track-1121-mobile.spec.js`.

**Verify before ticking**: both Playwright projects green, Vitest green, build green, and a
recorded manual observation. Reasoning about a diff is not verification.
