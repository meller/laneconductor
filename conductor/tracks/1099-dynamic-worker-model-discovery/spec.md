# Spec: Dynamic Worker Model Discovery (Track 1099)

## Problem

The `WorkerModelModal` and `ProvisionWorkerModal` use a globally hardcoded `MODEL_PRESETS` list
(defined in `WorkerModelModal.jsx`). This has two failure modes:

1. **Stale models**: new models (e.g. `claude-sonnet-5`) ship without any code change.
2. **Wrong models for the machine**: two workers running different CLI versions or with
   different API key tiers may have access to completely different model sets. A preset for
   `claude-opus-5` is meaningless on a worker whose API key doesn't have Opus access.

## Requirements

### REQ-1: Worker discovers its own models at startup

Each worker runs a CLI-specific discovery command once at startup, retries every 30 minutes
in the background, and includes the result in every heartbeat payload as `available_models`.

Discovery commands per CLI engine:

| CLI         | Command                             | Parse strategy                        | Fallback              |
|-------------|-------------------------------------|----------------------------------------|-----------------------|
| `claude`    | `claude models list --json` (if it exists), else `claude models list` | Parse JSON array or text lines | `null` (use UI presets) |
| `gemini`    | `gemini models list 2>/dev/null`    | Parse `text/` model IDs from JSON or lines | `null` |
| `antigravity` / `agy` | `agy models 2>/dev/null` | Parse JSON or lines | `null` |
| `copilot`   | No standard command — skip          | —                                      | `null`                |

If a command fails, times out (>10s), or produces unparseable output, store `null` (not an
error). Workers without a working discovery command just report `null` and the UI falls back
to presets — no failures, no broken flows.

### REQ-2: Server stores and exposes `available_models`

- `workers.available_models JSONB` — added via migration.
- Heartbeat `PATCH /worker/heartbeat` accepts `available_models` (array of `{id, label}` objects
  or plain string array) and writes it to the column.
- `GET /api/workers` and `GET /api/projects/:id/workers` return `available_models` in the row.

### REQ-3: UI prefers worker-reported models

In `WorkerModelModal` and `ProvisionWorkerModal`:

- If `worker.available_models` is a non-empty array → use it as the model list.
- Otherwise → fall back to `MODEL_PRESETS[cli]`.

The `MODEL_PRESETS` list is demoted to a **static fallback** — useful when a worker hasn't
reported yet, or for the `ProvisionWorkerModal` before a worker is assigned.

### REQ-4: Hardcoded presets are always kept current

The static fallback list (`MODEL_PRESETS`) is updated to include the latest known model IDs
for each provider. This is a manual-maintenance responsibility, but since it's only the
fallback (not the primary source), staleness is tolerable.

## Out of Scope

- Authenticating to provider APIs directly to fetch model lists (adds key management complexity).
- Real-time push of updated model lists (heartbeat cadence is sufficient).
- SSH-side provisioning (tracked separately in 1089).
