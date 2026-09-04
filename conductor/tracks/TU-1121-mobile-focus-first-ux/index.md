# Track TU-1121: Mobile UX — focus-first board

**Lane**: quality-gate
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Implementation complete — Task 6.7 (manual device pass) not performable in this environment, see conversation.md
**Type**: dev
**Track Kind**: feature
**Auto Run**: yes
**Merge Mode**: direct
**Author**: TU
**Created By**: test@example.com
**Summary**: app.laneconductor.com is unusable on a phone — the board renders a hard-coded 6-column grid (~41px lanes at 375px) and cards move via HTML5 drag-and-drop, which does nothing on touch. Implement the…

## Problem

Confirmed by reading the source, not by inference:

1. `ui/src/components/KanbanBoard.jsx:74` renders `grid grid-cols-6` with **no responsive variants**. At 375px, after `p-6` padding and `gap-4`, each lane is ~41px wide — track cards are unreadable slivers.
2. `ui/src/components/TrackCard.jsx:353` moves cards with HTML5 drag-and-drop (`draggable` / `onDragStart`). **That API does nothing on touch devices**, so moving a track between lanes is impossible on a phone even if the lanes fit.
3. `ui/src/components/TrackDetailPanel.jsx:683` is a fixed `w-96` / `max-w-2xl` right-hand panel — wider than a 375px viewport.
4. `App.jsx` uses `p-6` / `px-6` throughout, spending 48px of 375px on padding before any content.
5. Only 7 of 35 components carry any responsive treatment at all.

## Solution

Implement the approved design (direction B, "focus first"):
[Mobile UX canvas](https://claude.ai/code/artifact/7440ac62-4817-47b8-bdf7-679f84970901) — page 1 is the agreed flow; page 2 records the two rejected structures and why.

On a phone the job is monitoring autonomous agents, not re-planning — so the home screen leads with what is blocked and what is running (reusing the existing `/api/inbox` ⚠️/❌/✅ classification), and the board becomes a swipeable one-lane-at-a-time tab. Desktop behaviour is unchanged throughout.

## Phases

- [x] Phase 1: Mobile app shell — bottom tab nav (Focus / Board / Workers / More), responsive header with 44px targets, mobile padding scale
- [x] Phase 2: Board — replace `grid-cols-6` with a lane-at-a-time view below `md`, scrollable lane rail with counts, pinned swipe indicator; desktop grid untouched
- [x] Phase 3: Tap-to-move — a Move-to-lane bottom sheet replacing drag-and-drop on touch, sharing the lane-transition path drag already uses
- [x] Phase 4: Focus screen — "Needs your input" / "Running now" / pipeline summary, driven by the existing inbox classification
- [x] Phase 5: Track detail as a full-screen sheet on mobile, replacing the fixed `w-96` / `max-w-2xl` side panel
- [x] Phase 6 (automated): Playwright `mobile-chrome` project + full mobile spec, all green. Manual on-device pass (Task 6.7) NOT performed — no physical device in this environment; see conversation.md.

## Design reference

All six lanes, the exact card anatomy (8px radius, 12px padding, 6px progress bar) and the stock-Tailwind dark tokens in the canvas are lifted from the current components — the mockups extend the existing vocabulary rather than introducing a new one.
