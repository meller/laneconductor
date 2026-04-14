# Track 005: DB as Transport for Conductor File Content

## Phase 1: DB schema

**Problem**: No columns exist to store conductor file content or track markdown content.
**Solution**: Add `conductor_files` JSONB to `projects`, add content columns to `tracks`.

- [x] Task 1: Add `conductor_files` JSONB column to `projects` table
- [x] Task 2: Add `index_content`, `plan_content`, `spec_content` TEXT columns to `tracks` table
- [x] Task 3: Verify migration doesn't break existing rows (nullable columns, no defaults needed)

**Impact**: DB can store all conductor content. No data written yet.

---

## Phase 2: Heartbeat worker — push file content

**Problem**: Worker only pushes status fields. Full content stays on disk.
**Solution**: Extend worker to read and push all conductor files + per-track files on change.

- [x] Task 1: Push conductor context files on startup and on change
    - [x] Watch `conductor/*.md` and `conductor/code_styleguides/*.md`
    - [x] On change: read all context files, build JSON object, UPDATE `projects.conductor_files`
- [x] Task 2: Push track file content when any track file changes
    - [x] On `conductor/tracks/*/*` change: read index.md, plan.md, spec.md (skip missing)
    - [x] UPDATE `tracks.index_content`, `plan_content`, `spec_content`
- [x] Task 3: Initial push on worker startup (populate DB from current filesystem state)

**Impact**: DB always has current content of all markdown files.

---

## Phase 3: Express API — content endpoints

**Problem**: No API endpoints expose the new content columns.
**Solution**: Add two new endpoints.

- [x] Task 1: `GET /api/projects/:id/conductor` — returns parsed conductor_files JSONB
- [x] Task 2: `GET /api/projects/:id/tracks/:num` — returns track row including content columns

**Impact**: UI can fetch all content via API with no filesystem access.

---

## Phase 4: UI — context panel + track detail view ✅ COMPLETE

**Problem**: UI only shows Kanban cards with status. No content visibility.
**Solution**: Add project context panel and per-track detail view with markdown rendering.

- [x] Task 1: Add markdown renderer (use `marked` or similar, lightweight)
- [x] Task 2: Project context panel
    - [x] Sidebar or top panel with tabs: Product / Tech Stack / Workflow / Guidelines
    - [x] Each tab renders the corresponding conductor file as markdown
- [x] Task 3: Track detail view
    - [x] Click track card → opens detail panel/modal
    - [x] Tabs: Overview (index.md) / Plan (plan.md) / Spec (spec.md)
    - [x] Plan tab shows checkboxes as interactive (visual only, no write-back needed)
- [x] Task 4: Polish — loading states, empty states for missing files

**Impact**: Full conductor content visible in the dashboard.

## ✅ REVIEWED

## ✅ QUALITY PASSED
