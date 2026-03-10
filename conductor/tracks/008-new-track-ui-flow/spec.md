# Spec: New Track UI Flow

## Problem Statement
Every new piece of work requires dropping into the terminal and invoking Claude. The UI should be a self-contained control plane — including the ability to start new tracks and resume stalled ones.

## Requirements

### Phase 1: Server-side track creation
- REQ-1: `POST /api/projects/:id/tracks` — accepts `{ title, description }`, creates DB row + markdown files
- REQ-2: Server reads `repo_path` from the `projects` table to know where to write files
- REQ-3: Next track number computed server-side (MAX(track_number) + 1 for that project)
- REQ-4: Creates `conductor/tracks/NNN-slug/index.md`, `plan.md`, `spec.md` with template content
- REQ-5: Slug derived from title (lowercase, spaces→hyphens, strip special chars)
- REQ-6: Returns the created track row

### Phase 2: New Track modal
- REQ-7: Modal opens when "+ New Track" is clicked
- REQ-8: First section — "Resume a track?" — shows existing backlog and review tracks for the selected project as clickable cards
  - Clicking one moves it to `in-progress` (PATCH) and closes modal
- REQ-9: Second section — "Create new track" — text inputs for Title and Description (optional)
- REQ-10: Submit calls `POST /api/projects/:id/tracks`, then `refetch()`, then closes modal
- REQ-11: If no project is selected, modal shows only "Create new" with a project selector

### Phase 3: Header button
- REQ-12: "+ New Track" button in the board header, right of project selector
- REQ-13: ~~Disabled if no project selected~~ — removed. Modal handles no-project via project selector (REQ-11), so button is always useful.
- REQ-14: Keyboard shortcut: `N` opens the modal when no input is focused

## Acceptance Criteria
- [ ] Click "+ New Track" → modal appears showing backlog/review tracks for selected project
- [ ] Click a backlog track in modal → it moves to in-progress, modal closes, card moves column
- [ ] Fill title + submit → new card appears in Backlog within 2s
- [ ] New track's markdown files exist on disk at `conductor/tracks/NNN-slug/`
- [ ] `N` key opens the modal

## API Contract

### `POST /api/projects/:id/tracks`
Request:
```json
{ "title": "Auth middleware", "description": "JWT-based auth for all routes" }
```
Response (201):
```json
{
  "id": 42,
  "track_number": "008",
  "title": "Auth middleware",
  "lane_status": "backlog",
  "progress_percent": 0,
  "repo_path": "/home/user/myproject"
}
```
