# Track 006: Interactive Track Workflow

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
The Kanban board is read-only. There is no way to move cards between lanes, no way to record a conversation/blockers on a track, and no automated back-to-backlog flow when implementation hits something unexpected.

## Solution
Four-part feature:
1. Drag-and-drop lane changes in the UI (with confirm dialog) — API endpoint to write lane changes back to DB
2. Track conversation/comments — a comments column in DB, surfaced in track detail panel
3. Blocker capture during `implement` — the skill collects unplanned items and pushes them as comments
4. Back-to-backlog loop — when blockers exist, implementation pauses, comments are visible in UI, user responds in track conversation, plan is updated, re-implement runs

## Phases
- [ ] Phase 1: Drag-and-drop lane change (UX + API write endpoint)
- [ ] Phase 2: Track comments (DB schema + API + UI)
- [ ] Phase 3: Blocker capture during implement
- [ ] Phase 4: Back-to-backlog loop + re-implement skill flow
