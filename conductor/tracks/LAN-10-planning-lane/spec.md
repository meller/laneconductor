# Spec: Planning Lane + Smart New-Track Flow

## Problem Statement

New tracks auto-land in `in-progress` due to a template bug, there's no staging area
before implementation starts, and the UI always creates duplicate tracks where the SKILL
would have updated an existing one.

## Requirements

### REQ-1: Intake & Planning Workflow
- Track creation (UI or SKILL) writes to a local staging file: `conductor/tracks/intake.md`
- Intake entries include track number, title, description, and status (`pending-scaffold`)
- The sync worker pick up `planning` tracks and runs `/laneconductor planTrack`
- `planTrack` promotes intake entries to full folders and scaffolds the 3 core markdown files
- Physical folder creation is deferred until the "Planning" action actually runs

### REQ-2: Planning lane — data layer
- `planning` is a valid `lane_status` value (added to `VALID_LANES` in PATCH handler)
- `POST /api/projects/:id/tracks` inserts with `lane_status = 'planning'` (not `'backlog'`)
- `/laneconductor newTrack` SKILL command inserts with `lane_status = 'planning'`
- Auto-implement poll loop (sync.mjs) skips `planning` tracks — only fires on `in-progress`

### REQ-3: Planning lane — Kanban UI
- Kanban board shows a **Planning** column as the leftmost column
- Column order: **Planning | Backlog | In-Progress | Review | Done**
- Planning cards are styled distinctly (purple/indigo tint) to signal "needs a decision"
- PATCH drag-and-drop works for planning → any other lane (existing drag logic)
- NewTrackModal "Resume" section includes `planning` tracks (not just `backlog` + `review`)

### REQ-4: Planning lane — SKILL + sync worker
- SKILL.md badge mapping table: add `planning` row (default for new tracks, no marker)
- `/laneconductor pulse` accepts `planning` as a valid status
- SKILL.md badge table updated:
  | (none / new) | `planning` |   ← new default
  | (none in DB, explicitly `backlog`) | `backlog` |

### REQ-5: Smart intake in NewTrackModal
- When type = `feature`: after the user types a title (≥3 chars + 500ms debounce), query
  `GET /api/projects/:id/tracks?lane_status[]=planning,backlog,in-progress,review`
  and filter client-side for title similarity (case-insensitive substring or word overlap)
- If 1–3 matching non-done tracks are found: show a "💡 Might belong in:" suggestion
  section above the create form, listing the matching tracks with "Add to this track" button
- "Add to this track" calls `POST /api/projects/:id/tracks/:num/update` with the title +
  description as additional tasks to append to `plan.md` and `spec.md`
  (new API endpoint, same logic as `/laneconductor updateTrack`)
- If no matches: form behaves as today (create new)
- When type = `bug`: same flow but lower match threshold (bug descriptions often reference
  specific symptoms that map to a track scope)

### REQ-6: Consolidated Planning Action (`planTrack`)
- A single command handles both initial planning (scaffolding) and updates (incorporating feedback)
- It reads context from:
  1. `conductor/tracks/intake.md` (the intake staging record)
  2. Track conversation history (human comments)
  3. Existing track files (if updating)
- For updates: it appends new requirements/tasks and removes old completion badges (e.g., `✅ REVIEWED`)
- It cleans up `intake.md` after processing
- Triggered automatically by the worker when a track enters the `planning` lane

## Acceptance Criteria

- [x] Creating a track via UI lands it in the Planning column and writes to `intake.md`
- [x] No auto-implement fires immediately after creating a track
- [x] Dragging from Planning → In-Progress triggers auto-implement (if planning action is done)
- [x] Dragging from any lane → Planning triggers the `planTrack` auto-action
- [x] Planning column is visible in the Kanban board, leftmost
- [x] Typing a feature title ≥3 chars in the UI shows matching non-done tracks
- [x] Clicking "Add to this track" appends the request to `intake.md` and moves track to `planning`
- [x] `/laneconductor pulse 013 planning 100` is accepted; track can be marked done

## Out of Scope

- AI/semantic search for track matching (simple substring match is enough for now)
- Quality gate lane (separate track 012 covers this)
- Planning lane having special auto-actions (it now has `planTrack`)
