# Plan: Dynamic Worker Model Discovery (Track 1099)

## Phase 1: Database & Server
**Problem**: No column to store worker-reported models; heartbeat and API don't pass them through.

- [x] Task 1.1: Migration `20260811145600_add_worker_available_models.sql` — add `available_models JSONB` to `workers`.
- [x] Task 1.2: `PATCH /worker/heartbeat` — accept and persist `available_models` from heartbeat body.
- [x] Task 1.3: `GET /api/workers` — include `w.available_models` in SELECT.
- [x] Task 1.4: `GET /api/projects/:id/workers` — include `w.available_models` in SELECT.

## Phase 2: Worker Discovery (laneconductor.sync.mjs)
**Problem**: Worker doesn't probe the local CLI for available models and doesn't include them in the heartbeat.

- [x] Task 2.1: Add `discoverAvailableModels(cli)` function that runs a CLI-specific command, parses output into `[{id, label}]`, and returns `null` on failure/timeout.
  - `claude`: try `claude models list --json`; parse; fallback to text lines; return null if command not found or errors.
  - `gemini`: try `gemini models list`; parse model IDs; return null on failure.
  - `agy` / `antigravity`: try `agy models`; return null on failure.
  - `copilot`: return null (no standard listing command).
- [x] Task 2.2: At worker startup, run discovery and store result in module-level `cachedModels`.
- [x] Task 2.3: Re-run discovery every 30 minutes in the background (silently, no log spam).
- [x] Task 2.4: Include `available_models: cachedModels` in the heartbeat body (`updateWorkerHeartbeat`).
- [x] Task 2.5: Include `available_models: cachedModels` in the register body (`upsertWorker`).

## Phase 3: UI — Worker-Aware Model Picker
**Problem**: `WorkerModelModal` and `ProvisionWorkerModal` show global presets even when the worker has reported its own list.

- [x] Task 3.1: In `WorkerModelModal`: if `worker.available_models?.length > 0`, use it as the model `<select>` options; otherwise fall back to `MODEL_PRESETS[cli]`.
- [x] Task 3.2: In `ProvisionWorkerModal`: when a launcher worker is selected and it has `available_models`, show its models instead of the global presets for the matching CLI engine.
- [x] Task 3.3: Show a small indicator (e.g. "✓ live from worker" vs "fallback presets") in the model section so the user knows which source is active.

## Phase 4: Keep Presets Current (maintenance)
- [x] Task 4.1: Updated `MODEL_PRESETS` in `WorkerModelModal.jsx` to include `claude-sonnet-5`, `claude-opus-5`, and current Gemini/Copilot/Antigravity models.
- [ ] Task 4.2: Add a comment in `WorkerModelModal.jsx` linking to each provider's model page so future updates are easy to find.

## Phase 5: Tests
- [ ] Task 5.1: Unit test `discoverAvailableModels` — mock `child_process.execSync`; confirm it handles: valid JSON output, valid text lines, command-not-found, timeout, and empty output.
- [ ] Task 5.2: Server test — heartbeat with `available_models` array stores it and is returned by `GET /api/workers`.
