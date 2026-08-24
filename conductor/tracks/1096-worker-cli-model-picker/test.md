# Track 1096 Tests: Choose/Change Worker CLI + Model from UI

## Automated Integration Tests

### Test File: `ui/server/tests/track-1096-worker-model-picker.test.mjs`

1. **Worker Registration with CLI & Model**:
   - `POST /worker/register` sending `{ hostname: 'test-host', pid: 1234, cli: 'claude', model: 'claude-3-5-sonnet' }`.
   - Verify DB row contains `cli = 'claude'` and `model = 'claude-3-5-sonnet'`.

2. **GET Workers Payload**:
   - Call `GET /api/workers` and `GET /api/projects/:id/workers`.
   - Confirm returned worker objects include `cli` and `model` fields.

3. **Heartbeat Model Update**:
   - Call `PATCH /worker/heartbeat` with updated `model = 'claude-3-5-haiku'`.
   - Confirm database is updated with new model string.

4. **PATCH Worker Config Endpoint & Dispatch Queue**:
   - Call `PATCH /api/workers/:id/config` with `{ model: 'gpt-4o' }`.
   - Confirm worker table updated.
   - Confirm a `set_model` action is created in `worker_dispatch` for worker.

### Test File: `ui/src/components/WorkerModelModal.test.jsx` (Phase 6)

5. **TC-P6-1**: Changing only the model (same CLI as `worker.cli`) shows no
   provider-switch warning and `Save Configuration` stays enabled.
6. **TC-P6-2**: Selecting a different CLI shows the warning banner naming
   both providers, and disables `Save Configuration` until the
   confirmation checkbox is ticked — ticking it re-enables Save.
7. **TC-P6-3**: Switching the CLI selection back to the worker's original
   CLI clears the warning and re-enables Save without requiring the
   checkbox.
8. **TC-P6-4**: Confirming a switch, then picking a *different* new CLI,
   requires re-confirmation — Save is disabled again.

---

## Manual & UI Verification Steps

1. **Workers View Rendering**:
   - Open UI Workers tab.
   - Verify worker cards in Grid view show CLI icon (e.g. 🤖 Claude) and model badge (e.g. `claude-3-5-sonnet`).
   - Verify Strip view pill shows compact model text.

2. **Model Change Flow**:
   - Click "Change Model" on an active worker card.
   - Select `claude-3-5-haiku` (or custom model string).
   - Click "Save Model Assignment".
   - Confirm modal closes and worker badge updates immediately to `claude-3-5-haiku`.

3. **Provider Switch Confirmation (Phase 6)**:
   - Click "Change Model" on a worker currently set to Claude.
   - Click the Gemini CLI button — confirm an amber warning appears
     naming Claude and Gemini, and "Save Configuration" is disabled.
   - Tick "I understand — switch this worker to Gemini" — confirm Save
     becomes enabled.
   - Click Claude again — confirm the warning disappears and Save is
     enabled without re-ticking anything.

## Known Gaps

- Task 4.2 (browser E2E of the original model-picker flow) remains
  **partial** — rate-limited during the original implementation pass, not
  re-attempted here since Phase 6 is UI-logic-only (covered by the new
  Vitest component tests above) and doesn't change the modal's network
  calls.
