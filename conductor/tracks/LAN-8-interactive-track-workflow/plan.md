# Track 006: Interactive Track Workflow

## Phase 1: Drag-and-drop lane change + phase step indicator ✅ COMPLETE

**Problem**: Kanban is read-only. No way to move cards between lanes. No visibility into where a track is within its current phase.
**Solution**: HTML5 DnD + confirm dialog + PATCH API + `phase_step` DB column + phase stepper widget + action buttons on card.

### 1a — API write endpoint
- [x] Task 1: `PATCH /api/projects/:id/tracks/:num` — update `lane_status` and/or `phase_step` in DB
    - [x] Add route to Express server
    - [x] Validate lane_status ∈ {backlog, in-progress, review, done}
    - [x] Validate phase_step ∈ {planning, coding, reviewing, complete} (nullable)
    - [x] Return updated track row

### 1b — Phase step tracking (DB + heartbeat)
- [x] Task 2: Add `phase_step TEXT` column to `tracks` table
- [x] Task 3: Heartbeat worker parses `phase_step` from plan.md task completion within active phase
- [x] Task 4: Expose `phase_step` in all track API responses

### 1c — Phase stepper widget on TrackCard
- [x] Task 5: 4-dot stepper: Planning → Coding → Reviewing → Complete
    - [x] Completed steps = green filled, current = blue pulsing, future = grey
    - [x] Step label shown inline

### 1d — Action buttons on TrackCard
- [x] Task 6: "Review phase" button on in-progress cards → confirm → PATCH phase_step=reviewing + post comment
- [x] Task 7: "→ [Next lane]" button → confirm → PATCH lane_status

### 1e — Drag-and-drop
- [x] Task 8: TrackCard draggable with trackNum in dataTransfer
- [x] Task 9: Lane columns as drop zones with dragover highlight
- [x] Task 10: Same confirm dialog flow as buttons

**Impact**: Cards show phase step progress. Action buttons + DnD drive lane changes.

---

## Phase 2: Track comments ✅ COMPLETE

**Problem**: No persistent conversation thread on tracks.
**Solution**: `track_comments` table + GET/POST API + Conversation tab in TrackDetailPanel.

- [x] Task 1: DB migration — `track_comments` table (id, track_id FK, author, body, created_at)
- [x] Task 2: `GET /api/projects/:id/tracks/:num/comments` endpoint
- [x] Task 3: `POST /api/projects/:id/tracks/:num/comments` endpoint
- [x] Task 4: "Conversation" tab in TrackDetailPanel
    - [x] Polls comments every 2s
    - [x] Author-styled bubbles (human/claude/gemini)
    - [x] Textarea + Send button (⌘↵ shortcut)
    - [x] Auto-scroll to bottom on new comment

**Impact**: Track detail has a live conversation thread.

---

## Phase 3: Blocker capture during implement ✅ COMPLETE

**Problem**: `implement` runs blind — surprises or blockers are invisible.
**Solution**: Claude posts comments during implement for deviations and blockers.

- [x] Task 1: Update `implement` in SKILL.md with blocker capture pattern
    - [x] `ℹ️ NOTE:` for unplanned deviations (autonomous, continue)
    - [x] `⚠️ BLOCKED:` for items needing human input (→ review lane, stop)
- [x] Task 2: POST comment helper documented in SKILL.md
- [x] Task 3: Quick-reference table updated with `comment` command

**Impact**: Implement is transparent — all deviations visible in track Conversation.

---

## Phase 4: Back-to-backlog loop ✅ COMPLETE

**Problem**: No structured resume path after a blocker.
**Solution**: `implement` reads existing comments on startup; if last comment is from human, treats as blocker resolution.

- [x] Task 1: `implement` startup reads comments via API
- [x] Task 2: If last comment is from 'human' → incorporate as blocker resolution, update plan.md Decisions section
- [x] Task 3: SKILL.md documents the full loop: blocked → review → human responds → re-implement

**Impact**: Full back-to-backlog loop — blocked → human responds → re-implement picks up where it left off.

## Decisions
- Phase stepper uses inline dot + label (not tooltip-only) for clarity
- "Review phase" moves phase_step to 'reviewing' without changing lane (track stays in-progress unless user drags/buttons to review lane)
- Comments API uses track_id FK (not project_id+track_number) internally for clean SQL

## Phase 5: Graphical Workflow UI & Parallel Workers ✅ COMPLETE

**Problem**: The workflow configuration is JSON-based, and we lack a way to configure parallel workers per lane.
**Solution**: Add a visual node-based editor for the workflow and support `parallel_workers` configuration.

- [x] Task 5.1: Update `workflow.md` parser/writer to support `parallel_workers` per lane.
- [x] Task 5.2: Update sync worker to respect `parallel_workers` limits (polling multiple tracks).
- [x] Task 5.3: Add visual workflow editor package (e.g., React Flow) to the Vite dashboard.
- [x] Task 5.4: Implement node/edge rendering for lanes and transitions (success/fail arrows).
- [x] Task 5.5: Add graphical edit controls for retries and parallel workers.

## ✅ REVIEWED
## ✅ QUALITY PASSED
