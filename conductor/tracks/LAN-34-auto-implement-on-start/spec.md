# Spec: Auto-Implement on Start

## Problem Statement
Dragging a track to in-progress requires a second manual step — invoking Claude in the terminal. The Kanban board should be the only control plane. Moving to in-progress should automatically start implementation.

## Requirements

### Phase 1: Transition detection
- REQ-1: Worker polls DB every 5s for tracks where `lane_status = 'in-progress'` AND `progress_percent = 0` AND `auto_implement_launched IS NULL`
- REQ-2: Only triggers for `progress_percent = 0` — resumed tracks (progress > 0) are never auto-launched
- REQ-3: Requires a new `auto_implement_launched` column on `tracks` table (TIMESTAMP, nullable) to record when a launch was fired
- REQ-4: Worker reads `primary_cli` from the project row to know which CLI to invoke (`claude` / `gemini` / `other`)

### Phase 2: Auto-launch
- REQ-5: Launch command: `claude -p "/laneconductor implement NNN" --project-dir <repo_path>` (or equivalent for other CLIs)
- REQ-6: Only one implement process per project at a time — if one is already running, skip
- REQ-7: On launch: set `auto_implement_launched = NOW()` in DB immediately (prevents duplicate fires on next poll)
- REQ-8: Log launch to console: `[auto-implement] Launching implement for track NNN`

### Phase 3: UI + re-run
- REQ-9: Track card in in-progress lane shows a small "Auto-started" badge when `auto_implement_launched` is set and `progress_percent = 0`
- REQ-10: No automatic re-run after a track returns from review — user must explicitly drag back to in-progress or click a "Re-run implement" button
- REQ-11: A "Re-run implement" button appears on in-progress cards where `progress_percent > 0` — clicking it calls a new `POST /api/projects/:id/tracks/:num/implement` endpoint that fires the CLI and resets `auto_implement_launched`

### Phase 4: Auto-review on move to review lane
- REQ-12: Same pattern as auto-implement — when a track transitions to `review` lane AND `auto_review_launched IS NULL`, fire `/laneconductor review NNN` automatically
- REQ-13: New `auto_review_launched` column on `tracks` (TIMESTAMP, nullable)
- REQ-14: No re-run limit — each time the track re-enters `review`, a new review fires (each review is a separate gate)
- REQ-15: Only fires when the transition is to `review` and the track was `in-progress` before (not when manually dragged to review from backlog)

## Acceptance Criteria
- [ ] Drag track to in-progress at 0% → Claude starts implementing within 10s, no terminal interaction needed
- [ ] Drag a resumed track (progress > 0) to in-progress → no auto-launch
- [ ] Two tracks dragged simultaneously → only one launches at a time (queue or skip)
- [ ] Re-running requires explicit button click
- [ ] `auto_implement_launched` in DB correctly reflects launch time

- [ ] Move track to review lane → `/laneconductor review NNN` fires automatically, result posted as comment

## Schema Change
```sql
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS auto_implement_launched TIMESTAMP;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS auto_review_launched TIMESTAMP;
```
