# Track 008: New Track UI Flow

## Phase 1: POST /api/projects/:id/tracks endpoint ✅ COMPLETE

**Problem**: No server endpoint to create tracks from the UI.
**Solution**: Added `POST /api/projects/:id/tracks` to `ui/server/index.mjs`.

- [x] Task 1: Add `POST /api/projects/:id/tracks` to `ui/server/index.mjs`
    - [x] Read `repo_path` from `projects` table
    - [x] Compute next track number: `MAX(track_number)::int + 1` padded to 3 digits
    - [x] Derive slug from title (lowercase, spaces→hyphens, strip non-alphanumeric)
    - [x] Write `conductor/tracks/NNN-slug/index.md`, `plan.md`, `spec.md` using templates
    - [x] INSERT into `tracks` with `lane_status='backlog'`, `progress_percent=0`
    - [x] Return 201 with created row

## Phase 2: NewTrackModal component ✅ COMPLETE

**Problem**: No UI to create or resume tracks.
**Solution**: Created `ui/src/components/NewTrackModal.jsx`.

- [x] Task 1: Create `ui/src/components/NewTrackModal.jsx`
    - [x] Section A "Resume a track?" — list backlog/review tracks as clickable cards
        - [x] Clicking a card: PATCH to `in-progress`, close modal, refetch
    - [x] Section B "Create new track" — Title input + Description textarea
        - [x] Submit: POST to `/api/projects/:id/tracks`, refetch, close modal
    - [x] If no project selected: show only Section B with no resume list
    - [x] Loading/error states

## Phase 3: Header button + keyboard shortcut ✅ COMPLETE

**Problem**: No entry point in the UI to trigger track creation.
**Solution**: "+ New Track" button in board header, wired to modal, with N key shortcut.

- [x] Task 1: Add `+ New Track` button to header in `App.jsx`
    - [x] Button right of project selector
    - [x] Open NewTrackModal on click
- [x] Task 2: Add `N` keyboard shortcut
    - [x] `keydown` listener: open modal when `N` pressed and no input/textarea focused
- [x] Task 3: Wire modal close + refetch in App.jsx

## Phase 4: Fix Review Gaps ✅ COMPLETE

**Problem**: Review identified gaps to address.
**Solution**: REQ-13 removed — button is always enabled; modal handles no-project via project selector.

- [x] REQ-13 removed from spec (modal handles no-project selection internally)

## ✅ REVIEWED
