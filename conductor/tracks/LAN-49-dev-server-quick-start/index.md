# Track 1014: Dev Server Quick-Start from Kanban Card

**Lane**: done
**Lane Status**: success
**Progress**: 90%

## Problem
Reviewers in the `review` lane have to leave the dashboard to start a dev server. There is no way to see the running application without switching to a terminal. This breaks the review flow.

## Solution
Add a one-click "Start Dev Server" action to each Kanban card in the UI, so reviewers can instantly spin up the running app for a track without leaving the dashboard or opening a terminal.

## Phases
- [x] Phase 1: DB Migration + Config Schema
- [x] Phase 2: Express API — Start / Stop / Status
- [x] Phase 3: Sync Worker — Send Dev Config in /project/ensure
- [x] Phase 4: UI — Button + URL Badge + Stop on TrackCard
- [ ] Phase 5: Polish + Per-Track Worktree Support (Optional)

## ✅ COMPLETE

All core phases (1-4) implemented. Phase 5 (per-track worktree support) deferred pending Track 1012 integration.
