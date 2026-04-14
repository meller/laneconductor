# Spec: LaneConductor Config in UI (Track 1024)

## Problem Statement
Project configuration (primary/secondary CLI, model, dev server, quality gate) lives in `.laneconductor.json` and requires direct file editing or `lc config` CLI commands. There is no way to inspect or change these settings from the Kanban UI, forcing users to context-switch to a terminal.

## Goals
- Surface project config in the Kanban UI as a settings panel (peer to Workflow Settings)
- Allow editing: AI provider, model, dev server, quality gate toggle
- Persist changes to both the DB and the local `.laneconductor.json` via the existing API + sync worker

## API

### GET `/api/projects/:id/config`
Returns the project's editable configuration:
```json
{
  "primary": { "cli": "gemini", "model": "gemini-2.5-pro" },
  "secondary": { "cli": "claude", "model": "sonnet" },
  "dev": { "command": "npm run dev", "url": "http://localhost:3000" },
  "create_quality_gate": false,
  "mode": "local-api"
}
```
Source: DB columns (`primary_cli`, `primary_model`, `secondary_cli`, `secondary_model`, `create_quality_gate`) + `conductor_files.laneconductor_json` for `dev` and `mode`.

### PATCH `/api/projects/:id/config`
Accepts the same shape. Updates DB columns + writes `conductor_files.laneconductor_json` so the sync worker can write it back to disk.

## UI

### Trigger
A `⚙ Config` button in the project header bar (next to the existing `⚙ Workflow` button).

### Panel (ProjectConfigSettings.jsx)
Slide-in panel (same dimensions as WorkflowSettings — `w-[900px]`):

**Section: AI Configuration**
- Primary CLI: dropdown `claude | gemini | other`
- Primary Model: text input (e.g. `sonnet`, `gemini-2.5-pro`)
- Secondary CLI: dropdown + optional model input
- Enable Quality Gate: toggle

**Section: Dev Server**
- Command: text input (e.g. `npm run dev`)
- URL: text input (e.g. `http://localhost:3000`)

**Section: Project (read-only)**
- Mode, Repo path, Git remote — display only

Save button → PATCH `/api/projects/:id/config` → worker syncs to `.laneconductor.json`.

## Acceptance Criteria
- [ ] `GET /api/projects/:id/config` returns current config
- [ ] `PATCH /api/projects/:id/config` updates DB + conductor_files
- [ ] Sync worker writes updated `conductor_files.laneconductor_json` back to `.laneconductor.json`
- [ ] `ProjectConfigSettings.jsx` panel opens from header
- [ ] All fields editable, save shows success notification
- [ ] Changes reflected immediately in `lc status` and worker behaviour
