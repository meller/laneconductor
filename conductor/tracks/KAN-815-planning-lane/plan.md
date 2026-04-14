# Track 013: Planning Lane + Smart New-Track Flow

## Phase 1: Bug Fix — Remove ⏳ IN PROGRESS from Template

**Problem**: `plan.md` template uses a Phase 1 header with the IN-PROGRESS emoji+text marker,
which causes `parseStatus()` in the sync worker to return `'in-progress'` for every newly created
track, immediately triggering auto-implement.
**Solution**: Remove the `⏳ IN PROGRESS` marker from the template. No explicit marker →
`parseStatus()` returns `null` → DB lane_status is left unchanged (stays `planning` or `backlog`).

- [x] Task 1.1: Fix template in `ui/server/index.mjs`
    - [x] `trackTemplates()` — feature plan.md: change
      `## Phase 1: Implementation` (marker removed)
    - [x] `trackTemplates()` — bug plan.md: same fix (marker removed)
    - [x] Verify `parseStatus()` in sync.mjs returns `null` for the new template content
- [x] Task 1.2: Fix existing track 012 plan.md (user's track created with the buggy template)
    - [x] Remove marker from `conductor/tracks/012-*/plan.md` line 3
    - [x] Confirmed: parseStatus returns null for both templates

**Impact**: New tracks stay in their DB-assigned lane after creation. Auto-implement no longer fires immediately.

---

## Phase 2: Planning Lane — Data + API + Sync Worker + SKILL

**Problem**: No staging area between "just created" and "committed to build." New tracks default
to `backlog` but should sit in `planning` until the user reviews the generated files.
**Solution**: Add `planning` as a valid `lane_status`. Update all layers: DB, API, sync worker, SKILL.

- [x] Task 2.1: Update API valid lanes list
    - [x] In `ui/server/index.mjs` PATCH handler: `VALID_LANES` array → added `'planning'`
    - [x] `POST /api/projects/:id/tracks` INSERT: changed `'backlog'` → `'planning'`
- [x] Task 2.2: Update sync worker
    - [x] In `laneconductor.sync.mjs` auto-implement poll: `AND lane_status = 'in-progress'` already explicit — no change needed
    - [x] `parseStatus()` default for new tracks: `null` return already defers to DB — no change needed
    - [x] Heartbeat UPDATE: already filters `WHERE lane_status = 'in-progress'` — no change needed
- [x] Task 2.3: Update SKILL.md
    - [x] Badge mapping table: `(none / new)` row → `planning` (was `backlog`)
    - [x] `newTrack` command spec: updated DB INSERT docs to `lane_status = 'planning'`
    - [x] `pulse` command docs: added `planning` to valid statuses list

---

## Phase 3: Planning Column in Kanban UI

**Problem**: No UI column for `planning` lane. Planning tracks are invisible.
**Solution**: Add Planning as the leftmost Kanban column with distinct styling.

- [x] Task 3.1: Add Planning column to Kanban board
    - [x] In `KanbanBoard.jsx`: added `planning` lane as first entry in `LANES` array
    - [x] Column order: Planning | Backlog | In-Progress | Review | Done
    - [x] Column header: `text-indigo-400 border-indigo-800` styling
    - [x] Grid updated from `grid-cols-4` to `grid-cols-5`
- [x] Task 3.2: Update drag-and-drop
    - [x] Planning cards can be dragged to any other lane (existing drag logic handles it)
    - [x] Any lane can receive a drop into Planning (existing drop logic handles it)
    - [x] PATCH handler accepts `planning` (completed in Phase 2)
- [x] Task 3.3: Update NewTrackModal resume section
    - [x] `resumable` filter: added `t.lane_status === 'planning'` to OR condition
    - [x] `LANE_BADGE`: added `planning: 'bg-indigo-900 text-indigo-300'`

---

## Phase 4: Smart Intake — NewTrackModal Feature/Bug Search

**Problem**: NewTrackModal always creates a new track. The CLI SKILL checks for existing
tracks first (`featureRequest`, `reportaBug`). The UI should do the same.
**Solution**: As the user types a title (≥3 chars), search non-done tracks client-side and
surface a "might belong here" suggestion. "Add to this track" appends tasks instead of creating a new track.

- [x] Task 4.1: Add `POST /api/projects/:id/tracks/:num/update` endpoint
    - [x] Accepts `{ title, description }` (the new work to append)
    - [x] Reads the track's `plan.md` from filesystem (use `repo_path` from projects table)
    - [x] Appends `\n## Extension: [title]\n\n- [x] [task]\n` to plan.md
    - [x] If description present: appends `\n- REQ-EXT: [title] — [description]\n` to spec.md
    - [x] Responds `{ ok: true, track_number, title }`
    - [x] Does not change `lane_status`; added `existsSync` import to server
- [x] Task 4.2: Add title-match suggestion to NewTrackModal
    - [x] Added `matchingTracks()` helper: filters non-done tracks, word overlap ≥1 word ≥3 chars, max 3
    - [x] `suggestions` state + 500ms debounce effect on `[title, type, tracks, activeProjectId]`
    - [x] Suggestions rendered as amber-bordered cards with "Add to this →" button
- [x] Task 4.3: Handle "Add to this track" click
    - [x] `handleAddToTrack(track)` calls `POST /api/projects/:id/tracks/:num/update`
    - [x] On success: `onCreated?.()` + `onClose()`
    - [x] On error: inline error shown

Note: Column order updated per user request → Backlog | Planning | In-Progress | Review | Done

## Phase 5: Consolidated Intake & Planning (intake.md + planTrack)

**Problem**: The UI and SKILL were doing partial scaffolding, making the filesystem-to-DB sync complex. Planning was separated from "updating," but they share the same context requirements.
**Solution**: Move all initial intake to a staging file (`conductor/tracks/intake.md`) and consolidate all planning/scaffolding/updating into a single, intelligent `/laneconductor planTrack` command.

- [x] Task 5.1: Update UI Server to use `intake.md`
    - [x] `POST /api/projects/:id/tracks` now writes to `tracks/intake.md` instead of scaffolding full folders.
    - [x] `POST /api/projects/:id/tracks/:num/update` now appends to `tracks/intake.md` and resets track to `planning`.
- [x] Task 5.2: Consolidate SKILL.md commands
    - [x] `/laneconductor newTrack` updated to write to `intake.md`.
    - [x] `/laneconductor planTrack` added/expanded to handle both fresh scaffolding and updates:
        - [x] Reads `intake.md` + Conversation + existing files.
        - [x] Scaffolds folder (if new) or appends phases (if update).
        - [x] Cleans up `intake.md`.
    - [x] Removed redundant `/laneconductor updateTrack`.
- [x] Task 5.3: Update Workflow Configuration
    - [x] `conductor/workflow.md` updated to use `auto_action: planTrack` for the planning lane.

**Impact**: Filesystem is the absolute source of truth from the first "ping" of an idea. Consistent planning/update logic regardless of trigger source.

## ✅ REVIEWED
Ready for review.
