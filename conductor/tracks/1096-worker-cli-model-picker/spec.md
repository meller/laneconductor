# Track 1096 Specification: Choose/Change Worker CLI + Model from UI

## 1. Overview
Currently, workers inherit their CLI engine and LLM model from `.laneconductor.json` or CLI flags at launch time, with no mechanism in the LaneConductor UI to view, select, or change model assignments for active workers or newly launched workers.

Track 1096 introduces full UI lifecycle management for worker CLI engines and models:
1. **Visibility**: Display each worker's active CLI (`claude`, `copilot`, `gemini`, `antigravity`) and Model name on its worker card/pill in the UI.
2. **Dynamic Update**: Enable users to change an active worker's LLM model directly from the Workers View via an interactive Model Selector.
3. **Launch Configuration**: Provide CLI/model selection inputs when starting or provisioning workers.
4. **Hierarchy Rules**: Document — accurately — how a UI-driven model change
   interacts with the existing lane override (`workflow.json`) and project
   default (`.laneconductor.json`) precedence. This track does **not**
   introduce a new per-worker precedence tier; see §5.

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
  sourced from the canonical registry (`conductor/providers.mjs`, imported
  directly by `WorkerModelModal.jsx` as `../../../conductor/providers.mjs`
  and re-exported from there under the historical names `MODEL_PRESETS` /
  `CLI_ENGINES` for `ProvisionWorkerModal.jsx`), not hardcoded per
  component, so a new model only needs to be added in one place.
  *(Correction, this planning pass: an earlier revision of this spec said
  the registry was "mirrored for the browser bundle at
  `ui/src/lib/providers.js`". No such file exists, and none is needed —
  `conductor/providers.mjs` is plain ESM and Vite/Vitest resolve it across
  the `ui/` boundary directly. The same phantom-mirror claim is repeated in
  `conductor/providers.mjs`'s own header comment; that file belongs to
  track 10011, so it is flagged rather than edited here.)*
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
Two distinct launch paths exist in `WorkersList.jsx`, and this requirement
covers both:

- **"+ New Worker"** → `ProvisionWorkerModal.jsx`. **Done.** Picks CLI +
  model (live `available_models` from the delegating manager worker when
  reported — track 1099 — otherwise the registry presets) and sends both in
  the provision dispatch payload.
- **"Start Sync Worker"** → `handleWorkerAction('start')`, a bare
  `POST /api/projects/:id/worker/start` shown only on localhost. **Not
  done.** It has no picker at all: the worker comes up on whatever
  `.laneconductor.json` already says, which is exactly the "CLI-only, edit
  the file by hand" problem this track exists to remove. Tracked as Phase 7
  in plan.md.

### 3.4 Worker Card Model Badge — reload caveat
The badge on the card reflects `workers.cli` / `workers.model`, which the
API writes twice: once synchronously in `PATCH /api/workers/:id/config`,
and again on each `PATCH /worker/heartbeat` from the worker's own live
config. The worker's `set_model` handler mutates its in-memory config and
then calls `updateWorkerHeartbeat()` immediately, so the two agree within
one dispatch round-trip. Between the PATCH and the worker picking the
dispatch up, the badge is optimistic — it shows the requested value before
the worker has adopted it.

---

## 4. Worker Runtime Engine Sync

### 4.1 In-Memory Model Updates
In `conductor/laneconductor.sync.mjs`, the `set_model` dispatch handler:
- Mutates the live in-memory `config.project.primary` (`.cli` / `.model`) —
  **not** a separate `activeModel` variable. `getProject()` returns
  `config.project` by reference, so both `buildCliArgs` (spawn time) and
  `updateWorkerHeartbeat` (reporting) see the new value with no restart.
- **Also persists the change to `.laneconductor.json` on disk**, so it
  survives a worker restart.
- Reports `done` on the dispatch and heartbeats immediately, so the UI badge
  converges within one dispatch round-trip.

**Consequence, and the reason §5 below was rewritten:** because the change
lands in `config.project.primary`, "this worker's model" and "this
project's default model" are the same value. Two worker processes started
from the same checkout share one `.laneconductor.json`, and the worker
watches that file for reload — so changing one worker's model from the UI
does reach the other. Per-worker isolation would require a genuinely
separate runtime tier; that does not exist and is **not** claimed by this
track.

---

## 5. Model Resolution Precedence Hierarchy

The actual resolution, in `buildCliArgs` (`conductor/laneconductor.sync.mjs`),
is exactly two levels:

```js
const primary      = laneConfig.primary_cli   ?? proj.primary?.cli ?? 'claude';
const primaryModel = laneConfig.primary_model ?? proj.primary?.model;
```

1. **Lane-Level Override** — `workflow.json` `lanes.<lane>.primary_model`.
2. **Project Default** — `.laneconductor.json` `project.primary.model`,
   which is *also* what this track's UI writes. There is no third tier.

**`workers.cli` / `workers.model` are display columns only.** Nothing in the
spawn path reads them; they exist so the Workers View can render a badge and
so a heartbeat can report what the worker is actually running. Changing a
worker's model takes effect through the `set_model` dispatch mutating
`config.project.primary` (§4.1), not through those columns.

**Correction, this planning pass.** An earlier revision of this section
asserted a three-tier hierarchy with "Worker Runtime Assignment" sitting
between the lane override and the project default. That tier does not exist
in the code and never did — it also contradicts `conductor/workflow.md`,
which documents the project-wide precedence with no worker tier at all.
Leaving it in place would have let a reviewer sign off on a hierarchy the
product does not implement. Flagged for human review rather than resolved
here — see the ⚠️ FUNDAMENTALS CONFLICT note in `conversation.md`.

**Open question for a human (not resolved by this track):** is
project-scoped the *intended* semantics for "change this worker's model"? If
per-worker isolation is wanted, it belongs with the worker-identity work
(tracks 1084/1109), not here — this track's UI would then need to write a
per-worker column that `buildCliArgs` actually consults.
