# Track 1096 Specification: Choose/Change Worker CLI + Model from UI

## 1. Overview
Currently, workers inherit their CLI engine and LLM model from `.laneconductor.json` or CLI flags at launch time, with no mechanism in the LaneConductor UI to view, select, or change model assignments for active workers or newly launched workers.

Track 1096 introduces full UI lifecycle management for worker CLI engines and models:
1. **Visibility**: Display each worker's active CLI (`claude`, `copilot`, `gemini`, `antigravity`) and Model name on its worker card/pill in the UI.
2. **Dynamic Update**: Enable users to change an active worker's LLM model directly from the Workers View via an interactive Model Selector.
3. **Launch Configuration**: Provide CLI/model selection inputs when starting or provisioning workers.
4. **Hierarchy Rules**: Establish clear resolution precedence between lane overrides (`workflow.json`), worker runtime assignments, and project `.laneconductor.json` defaults.

---

## 2. Database & API Extensions

### 2.1 Database Schema Migration
Add columns to `workers` table:
```sql
ALTER TABLE "public"."workers" ADD COLUMN "cli" text NULL DEFAULT 'claude';
ALTER TABLE "public"."workers" ADD COLUMN "model" text NULL;
```

### 2.2 Worker Heartbeat & Registration
Update `POST /worker/register` and `PATCH /worker/heartbeat`:
- Accept `cli` and `model` fields in request body.
- Store/update `cli` and `model` in the `workers` database table.

Update `GET /api/workers` and `GET /api/projects/:id/workers`:
- Return `w.cli` and `w.model` in worker object payloads.

### 2.3 Worker Model Configuration Endpoint
Add endpoint `PATCH /api/workers/:id/config`:
- **Auth**: Requires project ownership or worker permission.
- **Body**: `{ cli?: string, model?: string }`
- **Behavior**:
  - Updates DB columns `cli` and `model` for target worker.
  - Inserts a high-priority `set_model` command into `worker_dispatch` for that worker (or emits real-time WebSocket signal).
  - Broadcasts `worker:updated` via WebSocket.

---

## 3. UI Component Enhancements (`WorkersList.jsx`)

### 3.1 Worker Card & Pill Displays
- **Grid Layout (Card)**:
  - Display CLI badge with icon (e.g. Claude 🤖, Gemini ✨, Copilot ✈️, Antigravity 🚀).
  - Display model badge (e.g. `claude-3-5-sonnet`, `gemini-1.5-pro`). If null, show `Default`.
  - Add clickable **"Change Model"** button / edit icon next to the model name.
- **Strip Layout (Pill)**:
  - Show compact model tag next to PID / hostname.

### 3.2 Model Selector Dialog / Modal
When clicking "Change Model" on a worker card:
- Displays modal/popover with options grouped by provider — model lists are
  sourced from the canonical registry (`conductor/providers.mjs`, mirrored
  for the browser bundle at `ui/src/lib/providers.js`), not hardcoded per
  component, so a new model only needs to be added in one place.
  - **Custom Model**: Input field for arbitrary model identifier strings.
- **Submit**: Sends `PATCH /api/workers/:id/config` and updates UI with optimistic loading indicator.
- **Provider-switch confirmation** (session continuity — see plan.md Phase 6):
  a *model* change within the worker's current CLI is applied immediately, no
  extra confirmation, because CLI session ids (e.g. Claude's
  `claude_session_id`) are provider-specific and unaffected by a same-provider
  model change. A *CLI/provider* change is different: it starts the worker on
  a fresh conversation under the new provider, so the dialog shows an amber
  warning naming both providers and requires an explicit
  "I understand — switch this worker to X" checkbox before `Save
  Configuration` is enabled. Re-selecting a different CLI resets that
  checkbox so a stale confirmation can't cover a later choice, and
  re-selecting the worker's original CLI clears the warning entirely. The
  prior provider's session id is never deleted by a switch — it resolves and
  resumes normally if the worker is switched back.

### 3.3 Worker Launch Picker
- Update worker start action (`handleWorkerAction('start')` or Start Modal) to allow selecting initial CLI & Model prior to launching.

---

## 4. Worker Runtime Engine Sync

### 4.1 In-Memory Model Updates
In `conductor/laneconductor.sync.mjs` (or worker process engine):
- Worker processes `set_model` dispatch commands from `worker_dispatch` inbox.
- Dynamically updates internal `activeModel` variable.
- Uses `activeModel` for subsequent prompt invocations.
- Includes updated `cli` and `model` in subsequent heartbeats.

---

## 5. Model Resolution Precedence Hierarchy

When a worker executes a task for a track in a specific lane, the LLM model is resolved in the following priority order:

1. **Lane-Level Override** (`workflow.json` `primary_model` / `secondary_model` for that track's current lane).
2. **Worker Runtime Assignment** (Model assigned to the specific worker via UI or `--model` startup flag).
3. **Project Default Configuration** (`.laneconductor.json` `primary.model` / `secondary.model`).
