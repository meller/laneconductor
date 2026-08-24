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

## Phase 6: Two real bugs found and fixed during live e2e verification (2026-08-12)

Found while testing a *different* track (1091) live in the browser — "the New Project flow and Activity panel don't work" turned out to trace back to this track's Phase 2 code, not either of those features.

**Bug 1 — `refreshModels()` blocked every worker's startup by 15-20+ seconds.**
`await refreshModels(); await upsertWorker();` ran discovery *before* registration, and `discoverAvailableModels` used `execSync` — which blocks the entire Node event loop for its whole duration, not just the calling async function. Measured live: worker registration took 16.47s before the fix, 0.088s after. This single-handedly broke a `node --test` run across 5+ unrelated track suites (1084, 1085, 1086, 1087, 1091 among them) whose poll windows assumed near-instant worker startup — the failures had nothing to do with those tracks' own code.

Two things were required, not one — worth recording since the first fix looked sufficient but wasn't:
1. Moved the call to *after* `upsertWorker()` (registration happens first).
2. Converting `discoverAvailableModels` from `execSync` to promisified `exec` (`child_process.exec` + `util.promisify`) — dropping the `await` on the caller alone does NOT help, since calling an async function still runs its body synchronously up to its first await/yield point, and there was no such point inside the old `execSync`-based version. The event loop was blocked either way until this was fixed.

Fixed in `conductor/laneconductor.sync.mjs`: `execSync` → `execAsync` (promisified `exec`) throughout `discoverAvailableModels`; call site now `await upsertWorker(); setTimeout(() => refreshModels()..., 0);`.

**Bug 2 — plain-text `claude models list` fallback returns garbage, not model IDs, and the code treats it as a valid result.**
There is no real `claude models list` (nor `--json`) subcommand — confirmed live: `claude models list --json` errors with "unknown option", and plain `claude models list` falls through to Claude's own conversational interpreter, which replies with clarifying prose (exit code 0, so the "not available" catch branch never fires). The code's fallback parser (`stdout.split('\n')...`) took each line of that prose and returned it as a `{id, label}` "model" — confirmed live in the real `available_models` column: entries like `"Could you clarify what you'd like to know about \"models\"? A few possibilities:"` sitting alongside real model IDs. This would show up as bogus selectable options in `WorkerModelModal`/`ProvisionWorkerModal` for any worker whose `claude` CLI doesn't support a real listing command — i.e. every real-world worker today, since no such command exists.
- [ ] Not yet fixed — needs a decision: either validate discovered "model IDs" against an expected shape (e.g. `/^claude-/` or a max line length, given legitimate model IDs are short single tokens, not full sentences) before accepting them, or drop the plain-text `claude models list` fallback entirely and rely on the `agy models` fallback / static presets for `claude`, since the plain-text path has no real signal to parse without a genuine listing command.
