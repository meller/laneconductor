# Plan: LaneConductor Config in UI (Track 1024)

## Phase 1: API Endpoints

**Problem**: No REST endpoints to read/write project config separately from the full project row.
**Solution**: Add `GET` and `PATCH` `/api/projects/:id/config` to `ui/server/index.mjs`.

- [x] Task 1: Add `GET /api/projects/:id/config`
    - [x] Query DB for `primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate, conductor_files, repo_path, git_remote, mode`
    - [x] Parse `conductor_files.laneconductor_json` for `dev.command`, `dev.url`
    - [x] Return merged config JSON
- [x] Task 2: Add `PATCH /api/projects/:id/config`
    - [x] Accept `{ primary, secondary, dev, create_quality_gate }`
    - [x] UPDATE DB columns: `primary_cli, primary_model, secondary_cli, secondary_model, create_quality_gate`
    - [x] Merge `dev` into `conductor_files.laneconductor_json` and UPDATE `conductor_files`
    - [x] Broadcast `project:updated` via WebSocket
- [x] Task 3: API endpoints implementation complete

**Impact**: Config readable and writable from UI with DB + disk consistency.

---

## Phase 2: ProjectConfigSettings UI Component

**Problem**: No UI panel for project configuration.
**Solution**: `ui/src/pages/ProjectConfigSettings.jsx` modeled on `WorkflowSettings.jsx`.

- [x] Task 1: Create `ProjectConfigSettings.jsx`
    - [x] `fetchConfig()` → `GET /api/projects/:id/config`
    - [x] Form state: `primary`, `secondary`, `dev`, `createQualityGate`
    - [x] `handleSave()` → `PATCH /api/projects/:id/config` → success notification
- [x] Task 2: AI Configuration section
    - [x] Primary CLI: `<select>` with claude/gemini/other options
    - [x] Primary Model: `<input>` text
    - [x] Secondary CLI: `<select>` (with "none" option)
    - [x] Secondary Model: `<input>` text (hidden when secondary = none)
    - [x] Quality Gate: `<input type="checkbox">` toggle
- [x] Task 3: Dev Server section
    - [x] Command: `<input>` text with placeholder
    - [x] URL: `<input>` text with placeholder
- [x] Task 4: Read-only Project section
    - [x] Mode badge, repo_path, git_remote display

**Impact**: Full project config visible and editable from Kanban UI.

---

## Phase 3: Wire into App

**Problem**: No way to open the config panel from the UI.
**Solution**: Add `⚙ Config` button to the project header.

- [x] Task 1: Locate the project header component (App.jsx)
    - [x] Found where the `⚙ Workflow` button lives
    - [x] Added `⚙ Config` button next to it, same styling (blue instead of purple)
- [x] Task 2: Wire `configOpen` state
    - [x] Imported `ProjectConfigSettings` in App.jsx
    - [x] Added `configOpen` state variable
    - [x] Rendered `<ProjectConfigSettings projectId={...} onClose={...} />` when open
    - [x] Closes properly via onClose handler

**Impact**: One-click access to project config from the Kanban board.

---

## ✅ QUALITY PASSED

Quality Gate Results (2026-03-04):
- ✅ Syntax: 0 errors across all .mjs files
- ✅ Critical files: All present
- ✅ Config validation: project.id = 1
- ✅ Command reachability: make help + lc v1.0.0
- ✅ Worker E2E: 4/4 pass
- ✅ Server tests: 74/74 pass (fixed 3 stale mocks for queueFileSync + SELECT old track)
- ⚠️ Coverage: 51% line (below 80% goal — pre-existing gap in index.mjs, no threshold enforced)
- ✅ Security: 0 high/critical vulnerabilities
