# Track 1096 Plan: Choose/Change Worker CLI + Model from UI

## Phase 1: Database Migration & API Server Support
- [x] Task 1.1: Create database migration (`008_worker_cli_model.sql`) adding `cli` and `model` columns to `workers` table.
- [x] Task 1.2: Update `POST /worker/register` in `ui/server/index.mjs` to receive, validate, and persist `cli` and `model`.
- [x] Task 1.3: `GET /api/workers` query includes `w.cli` and `w.model` columns.
- [x] Task 1.4: Implemented `PATCH /api/workers/:id/config` endpoint — validates CLI engine, updates `workers` table, queues `set_model` action into `worker_dispatch`.

## Phase 2: Worker Daemon Sync Engine
- [x] Task 2.1: Worker heartbeat payload includes `cli` and `model` fields (via `laneconductor.sync.mjs`).
- [x] Task 2.2: `set_model` dispatch action handler updates in-memory config on next heartbeat without restart.

## Phase 3: UI Components & Model Picker Modal
- [x] Task 3.1: Created `WorkerModelModal.jsx` with CLI engine toggle buttons (Claude, Gemini, Copilot, Antigravity) and per-provider model dropdown with preset model lists + custom model fallback.
- [x] Task 3.2: Updated `WorkersList.jsx` grid and strip layouts to render CLI icon badge + model tag on each worker card.
- [x] Task 3.3: "Change Model" button on worker cards (both grid and strip) opens `WorkerModelModal`.
- [x] Task 3.4: Modal submits to `PATCH /api/workers/:id/config`; triggers `onRefresh` callback to refresh worker list.
- [x] Task 3.5: Exported `MODEL_PRESETS` and `CLI_ENGINES` from `WorkerModelModal.jsx` for reuse in `ProvisionWorkerModal`.
- [x] Task 3.6: Updated `MODEL_PRESETS` to current model IDs:
  - Claude: Sonnet 4.5, Opus 4.5, 3.7 Sonnet, 3.5 Sonnet, 3.5 Haiku
  - Gemini: 2.5 Pro, 2.5 Flash, 2.5 Flash Lite, 2.0 Flash, 1.5 Pro
  - Copilot: GPT-4o, GPT-4o mini, o3, o3-mini, o1
  - Antigravity: Auto, Gemini 2.5 Pro/Flash, Claude Sonnet 4.5

## Phase 4: Integration Testing & Verification
- [x] Task 4.1: `ui/server/tests/track-1096-worker-cli-model.test.mjs` — 4 tests pass:
  - PATCH config updates worker + queues `set_model` dispatch
  - Validates CLI engine (rejects unsupported engines)
  - Returns 404 for unknown workers
  - POST /worker/register persists CLI + model
- [ ] Task 4.2: Browser E2E verification — **partial** (rate-limited). Known remaining issues:
  - Server restart needed for `provision-targets` routes to be live (endpoints registered in code but running instance predates migration)
  - Both modals (`ProvisionWorkerModal`, `WorkerModelModal`) open correctly once server restarts

## Phase 5: UX Fixes (post-implementation)
- [x] Fix: `+ New Worker` button and `Change Model` button were not opening modals — modals were not rendered in grid layout when workers are present. Fixed by including all three modals in both grid and strip layout return blocks.
- [x] Fix: `ProvisionWorkerModal` had no model list per provider — replaced free-text input with per-CLI preset dropdown (shared from `WorkerModelModal`).
- [x] Fix: Added **Project selector** to `ProvisionWorkerModal` — fetches all projects from `/api/projects`, lets user pick which project the new remote worker will be assigned to. `target_project_id` included in dispatch payload.
- [x] Fix: Launcher worker list now shows manager workers first (preferred as SSH delegators) and includes project name for clarity.

## Phase 6 (2026-08-12): Provider vs. model — session continuity constraint

**Problem** (raised during live e2e review): the "Change Model" dialog lets
you change both the **CLI/provider** and the **model** on an existing
worker, but those aren't equivalent operations. A Claude session is resumed
via `claude --resume <claude_session_id>` (track 1086's `track_sessions`) —
that id is Claude-specific. Changing the *model* within Claude keeps
`--resume` working, so the worker keeps its conversation history. Changing
the *provider* (Claude → Gemini/Antigravity/Copilot) makes every stored
session id meaningless: there is nothing to resume, and the worker starts
cold on its next turn, silently losing continuity the user believed they
had.

Today the UI presents both dropdowns identically, with no indication that
one is lossy.

- [ ] Task 6.1: Decide the rule — most likely: model is freely changeable
      on an existing worker; provider is either disabled outright for a
      worker with existing sessions, or requires an explicit confirm that
      names the consequence ("this worker's conversation history can't be
      resumed under a different provider — it will start fresh").
- [ ] Task 6.2: Implement in `WorkerModelModal.jsx`, and make the same
      distinction wherever else provider is selectable for an *existing*
      worker.
- [ ] Task 6.3: Confirm the actual behavior first rather than assuming —
      check whether `resolveTrackSession`/`spawnCli` already handle a
      provider switch gracefully (e.g. by discarding the stale session id
      and starting fresh) or whether it errors. The UI wording depends on
      which it is.
