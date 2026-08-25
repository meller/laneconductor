# Track 008: New Track UI Flow

**Lane**: plan
**Lane Status**: queue
**Progress**: 85%
**Last Run**: claude/claude-sonnet-5 (primary)

## Problem
There is no way to start work from the UI. Creating a track requires the Claude CLI (`/laneconductor newTrack`). The UI should have a "New Track" button that either surfaces an existing track to resume, or creates a new one — without leaving the browser.

## Solution
A "+ New Track" button in the board header. Clicking opens a modal that first checks for existing backlog/review tracks ("Resume this?"), and if the user wants something new, collects name + description and calls a `POST /api/projects/:id/tracks` endpoint. The server creates both the DB row and the markdown files on disk (it knows `repo_path`). The new card appears on the board within 2s.

## Phases
- [x] Phase 1: `POST /api/projects/:id/tracks` endpoint + file creation on server
- [x] Phase 2: New Track modal in UI (resume existing or create new)
- [x] Phase 3: "+ New Track" button in board header, wired to modal
- [x] Phase 4: Fix Review Gaps
- [x] Phase 5: Expose per-track config at creation time
**Summary**: Quality gate FAILED — the card had been advanced to quality-gate:queue at 100% with neither of review's two documented gaps actually fixed in code (zero diff since the Phase 5 implement commit; only index.md's lane marker had moved, almost certainly a stale/racing process). Gaps unchanged: (1) `ui/server/utils.mjs` hardcodes a second copy of the merge/workspace mode allow-lists instead of importing the canonical `VALID_MODES`, and (2) `spec.md` was never updated with Phase 5's REQs/ACs. Routed to plan:queue per workflow.json. See conversation.md and plan.md for full detail.
