# Track 1096 Tests: Choose/Change Worker CLI + Model from UI

## Test Commands

```bash
# Both suites for this track (8 tests — last run 2026-08-24: 8/8 pass)
cd ui && npx vitest run \
  src/components/WorkerModelModal.test.jsx \
  server/tests/track-1096-worker-cli-model.test.mjs

# Whole UI suite (regression check before review)
cd ui && npm test
```

## Automated Integration Tests

### Test File: `ui/server/tests/track-1096-worker-cli-model.test.mjs`

> Filename corrected 2026-08-24 — this section previously named
> `track-1096-worker-model-picker.test.mjs`, which has never existed.
> Status marks below were verified against the actual `it(...)` blocks, not
> assumed.

1. ✅ **Worker Registration with CLI & Model** (`persists cli and model
   during registration`):
   - `POST /worker/register` sending `{ hostname: 'test-host', pid: 1234, cli: 'claude', model: 'claude-3-5-sonnet' }`.
   - Verify DB row contains `cli = 'claude'` and `model = 'claude-3-5-sonnet'`.

2. ❌ **GET Workers Payload** — *specified, not written*:
   - Call `GET /api/workers` and `GET /api/projects/:id/workers`.
   - Confirm returned worker objects include `cli` and `model` fields.
   - (The columns *are* in both queries — verified by reading them — so this
     is a coverage hole on a working path.)

3. ❌ **Heartbeat Model Update** — *specified, not written; Phase 7 Task 7.4*:
   - Call `PATCH /worker/heartbeat` with updated `model = 'claude-3-5-haiku'`.
   - Confirm database is updated with new model string.
   - The route builds its `SET` list with `if (cli !== undefined)` /
     `if (model !== undefined)`, so also assert the **omission** case: a
     heartbeat with no `cli`/`model` key must leave the stored values alone
     rather than nulling them.

4. ✅ **PATCH Worker Config Endpoint & Dispatch Queue** (`updates worker cli
   and model, and queues set_model dispatch`, plus `validates cli engine`
   and `returns 404 when worker is not found`):
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

All four ✅ pass.

### Phase 7 — cases for the remaining work (not yet written)

9. **TC-P7-1** (Task 7.3): the "Start Sync Worker" button opens a picker
   with the same CLI/model options as `ProvisionWorkerModal`, sourced from
   `conductor/providers.mjs` — expected: no third hardcoded model list
   anywhere (`grep -rn "claude-3-5-sonnet" ui/src` finds no new literal).
10. **TC-P7-2** (Task 7.3b): `POST /api/projects/:id/worker/start` with
    `{ cli, model }` writes those into the project's `.laneconductor.json`
    `project.primary` before spawning — expected: the file on disk contains
    the chosen pair and the started worker's first heartbeat reports it.
11. **TC-P7-3** (Task 7.3c, regression): the same POST with **no body**
    must not touch `.laneconductor.json` — expected: file mtime and content
    unchanged, worker boots on the pre-existing config. This is the case
    that keeps the new picker from silently rewriting a user's config.
12. **TC-P7-4** (Task 7.4): the heartbeat cases in item 3 above.

### Registry-sourcing regression (spec §3.2)

13. **TC-REG-1**: adding a model to `conductor/providers.mjs` makes it
    appear in both `WorkerModelModal` and `ProvisionWorkerModal` with no
    other file edited — expected: one-file change is sufficient. Guards the
    property Task 3.6 established, which two earlier revisions of these
    docs described incorrectly.

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

   - **Then confirm the mechanism, not just the badge**: the worker log
     shows `[dispatch] set_model cli=…, model=…`, and
     `.laneconductor.json`'s `project.primary.model` was rewritten on disk.
     The badge can update from the API's own write while the worker never
     adopts the change, so the badge alone is not evidence (spec.md §4.1).

3. **Provider Switch Confirmation (Phase 6)**:
   - Click "Change Model" on a worker currently set to Claude.
   - Click the Gemini CLI button — confirm an amber warning appears
     naming Claude and Gemini, and "Save Configuration" is disabled.
   - Tick "I understand — switch this worker to Gemini" — confirm Save
     becomes enabled.
   - Click Claude again — confirm the warning disappears and Save is
     enabled without re-ticking anything.

## Known Gaps

As of the 2026-08-24 planning pass:

- **Task 4.2 — browser E2E never performed.** Automated coverage is green
  (8/8), but no one has driven the real UI. plan.md Task 4.2 now lists the
  exact steps, including restarting the API server and worker first.
- **Items 2 and 3 above are specified but unwritten** — `GET /api/workers`
  payload shape and heartbeat model update. Both code paths were read and
  are correct; the tests just don't exist.
- **Phase 7 Task 7.3 is unbuilt** — the "Start Sync Worker" launch path has
  no CLI/model picker, so TC-P7-1..3 cannot pass yet.

These are why this track is **not** at 100% and must not be moved to `done`
on the strength of the passing unit tests alone.
