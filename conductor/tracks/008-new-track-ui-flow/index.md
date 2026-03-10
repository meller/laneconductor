# Track 008: New Track UI Flow

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
There is no way to start work from the UI. Creating a track requires the Claude CLI (`/laneconductor newTrack`). The UI should have a "New Track" button that either surfaces an existing track to resume, or creates a new one — without leaving the browser.

## Solution
A "+ New Track" button in the board header. Clicking opens a modal that first checks for existing backlog/review tracks ("Resume this?"), and if the user wants something new, collects name + description and calls a `POST /api/projects/:id/tracks` endpoint. The server creates both the DB row and the markdown files on disk (it knows `repo_path`). The new card appears on the board within 2s.

## Phases
- [ ] Phase 1: `POST /api/projects/:id/tracks` endpoint + file creation on server
- [ ] Phase 2: New Track modal in UI (resume existing or create new)
- [ ] Phase 3: "+ New Track" button in board header, wired to modal
