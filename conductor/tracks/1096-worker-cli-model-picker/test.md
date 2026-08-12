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
