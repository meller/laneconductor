# Track 1096 Tests: Choose/Change Worker CLI + Model from UI

## Test Commands

```bash
# All suites for this track (25 tests — last run 2026-08-24 [implement]: 25/25 pass)
cd ui && npx vitest run \
  src/components/WorkerModelModal.test.jsx \
  src/components/WorkersList.test.jsx \
  server/tests/track-1096-worker-cli-model.test.mjs \
  server/tests/track-10011-providers.test.mjs

# Whole UI suite (regression check before review)
# Last run 2026-08-24: 327/338 pass. The 11 failures are in auth.test.mjs,
# api-routes.test.mjs, bug-to-test.test.mjs, api-keys.test.mjs,
# track-1033-worker-auth.test.mjs — confirmed pre-existing via `git stash`
# (identical failures with this track's changes fully reverted), not
# something Phase 7 introduced.
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

3. ✅ **Heartbeat Model Update** (`updates the stored model on heartbeat`,
   plus `leaves stored cli/model untouched when a heartbeat omits them`) —
   written in [implement], Phase 7 Task 7.4:
   - `PATCH /worker/heartbeat` with `model = 'claude-3-5-haiku'` → asserts
     the `UPDATE workers SET` params include it.
   - Omission case: a heartbeat with no `cli`/`model` key → asserts the
     `SET` clause string contains neither `cli = $` nor `model = $`, i.e.
     an unrelated heartbeat can't null out a previously-set model. Mirrors
     the existing `PATCH /worker/heartbeat with cli:agy` precedent in
     `track-10011-providers.test.mjs`.

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

### Test File: `ui/server/tests/track-1096-worker-cli-model.test.mjs` (Phase 7, `POST /api/projects/:id/worker/start`)

9. ✅ **TC-P7-2** (`forwards cli/model from the request body into the
   spawned lc start args`): **course-corrected from the original spec**
   during implement (see plan.md Task 7.3b) — `{ cli, model }` does **not**
   write to `.laneconductor.json`. It forwards them as `--cli`/`--model`
   flags to `lc start`, the same in-memory-only, per-process mechanism
   track 10011 already built and `/workers/start-new` already uses.
   Asserted via the `execFile` mock: `args === ['start', '--cli', 'gemini',
   '--model', 'gemini-2.5-pro']`.
10. ✅ **TC-P7-3** (`omits --cli/--model entirely when not provided`,
    regression): an empty body → `args === ['start']`, byte-identical to
    pre-Phase-7 behavior. (Superseded the originally-planned "file mtime
    unchanged" assertion — there is no file write in this mechanism to
    check.)
11. ✅ **TC-P7-2b** (`rejects an unsupported cli engine`): `{ cli:
    'unsupported-cli' }` → `400`, `execFile` never called. Mirrors `PATCH
    /api/workers/:id/config`'s existing validation.

### UI: "Start Sync Worker" picker (Task 7.3a)

12. **TC-P7-1** (manual — see Manual Verification below): the "Start Sync
    Worker" button (`WorkersList.jsx` grid empty-state, the only place it
    renders) now shows two `<select>`s — CLI and Model — sourced from
    `CLI_ENGINES`/`MODEL_PRESETS` (re-exported from `WorkerModelModal.jsx`,
    themselves derived from `conductor/providers.mjs`) — before the Start
    button, matching `ProvisionWorkerModal`'s options. No third hardcoded
    model list was added (`grep -c "claude-3-5-sonnet" ui/src/components/WorkersList.jsx` → 0).
13. **TC-P7-4**: the heartbeat cases — see item 3 above.

### Registry-sourcing regression (spec §3.2)

14. **TC-REG-1**: adding a model to `conductor/providers.mjs` makes it
    appear in both `WorkerModelModal` and `ProvisionWorkerModal` with no
    other file edited — expected: one-file change is sufficient. Guards the
    property Task 3.6 established, which two earlier revisions of these
    docs described incorrectly.

---

## Manual & UI Verification Steps

**Status: performed 2026-08-24, [implement] Phase 8 — see plan.md for the
full write-up (isolation setup, live findings, and an incident/recovery
worth reading before repeating this against a real project).** Steps below
kept as the reusable checklist; results noted inline.

1. **Workers View Rendering** — ✅ confirmed live:
   - Open UI Workers tab.
   - Verify worker cards in Grid view show CLI icon (e.g. 🤖 Claude) and model badge (e.g. `claude-3-5-sonnet`).
   - Verify Strip view pill shows compact model text.

2. **Model Change Flow** — ✅ confirmed live, **with a caveat learned the
   hard way — read before repeating**: don't run this against a project
   with active workers you don't want to affect. `set_model` changes that
   *project's* default (spec.md §4.1), reaching every worker sharing the
   checkout within one heartbeat, not just the card you clicked. Use a
   dedicated verification project.
   - Click "Change Model" on an active worker card.
   - Select `claude-3-5-haiku` (or custom model string).
   - Click "Save Model Assignment".
   - Confirm modal closes and worker badge updates immediately to `claude-3-5-haiku`.

   - **Then confirm the mechanism, not just the badge**: the worker log
     shows `[dispatch] set_model cli=…, model=…`, and
     `.laneconductor.json`'s `project.primary.model` was rewritten on disk.
     The badge can update from the API's own write while the worker never
     adopts the change, so the badge alone is not evidence (spec.md §4.1).
     Confirmed directly against the DB this pass: all of a project's fresh
     workers converged to the new model within their next heartbeat.

3. **Provider Switch Confirmation (Phase 6)** — ✅ confirmed live, exact
   match to the Vitest-verified behavior:
   - Click "Change Model" on a worker currently set to Claude.
   - Click the Gemini CLI button — confirm an amber warning appears
     naming Claude and Gemini, and "Save Configuration" is disabled.
   - Tick "I understand — switch this worker to Gemini" — confirm Save
     becomes enabled.
   - Click Claude again — confirm the warning disappears and Save is
     enabled without re-ticking anything.

4. **Start Sync Worker picker (Phase 7, TC-P7-1)** — ✅ picker rendering
   and CLI→Model repopulation confirmed live; **Start itself deliberately
   not clicked** this pass (it spawns a real, if sync-only, background
   process — see plan.md Phase 8's incident note for why extra caution was
   applied after the Model Change flow's near miss above):
   - With zero workers registered for a project, open its Workers tab.
   - Confirm two dropdowns (CLI, Model) appear next to "Start Sync Worker",
     defaulting to Claude / the top Claude preset.
   - Change CLI to Gemini — confirm the Model dropdown repopulates with
     Gemini presets (no leftover Claude model id).
   - Click "Start Sync Worker" — confirm the spawned worker's first
     heartbeat reports `cli: 'gemini'` and the chosen model (check
     `conductor/.sync.log` for `[config]` startup line, or the worker's
     card once it appears). *(Not performed this pass — next reviewer with
     a disposable test project can close this last sliver.)*

5. **"+ New Worker"** — not exercised this pass (no manager worker was
   online); pre-existing gap, unrelated to Phase 7.

## Known Gaps

As of the 2026-08-24 [implement] Phase 8 pass:

- **Task 4.2 is done.** Browser E2E was performed for real (see above and
  plan.md Phase 8). The only sliver left unclicked is "Start Sync Worker"'s
  actual spawn (step 4 above) — deliberately deferred to avoid a second
  live side effect in the same session, not because it's expected to
  behave differently from what was already confirmed (the picker UI and
  its data flow into the request body were verified; only the resulting
  process's own heartbeat was not watched).
- Automated coverage: 25/25 for this track's suites, 327/338 for the whole
  UI test run with the 11 failures confirmed pre-existing. plan.md's Task
  4.2 previously listed "restart the API server and worker" as a
  prerequisite — that step was replaced with an isolated instance instead
  (see plan.md Phase 8), which is what let this pass actually verify
  `PATCH /api/workers/:id/config` and the new `/worker/start` cli/model
  handling against a real running process rather than deferring again.
- ~~Items 2 and 3 (GET payload shape, heartbeat model update) unwritten~~
  — **item 3 resolved** this pass (TC-3 / heartbeat tests added and
  passing). Item 2 (`GET /api/workers` field coverage) remains a real but
  minor gap — the columns are correctly in both queries (verified by
  reading), it's purely a missing assertion, not a Phase 7 scope item.
- ~~Phase 7 Task 7.3 unbuilt~~ — **done.** See TC-P7-1/2/2b/3 above. Note
  the mechanism differs from what this doc originally specified (disk
  write) — it uses the existing in-memory `--cli`/`--model` flag mechanism
  instead; see plan.md Task 7.3b for why.

**Remaining, genuinely small:** the "Start Sync Worker" button's actual
spawn was not clicked (step 4 above) — the picker rendering and its data
flow were confirmed, but not the resulting process's own heartbeat. The
"+ New Worker" picker form was unreachable (no manager online), and
`GET /api/workers` field coverage (item 2) has no dedicated test. None of
these block `done` on their own weight — they're coverage completeness,
not unverified core behavior — but they're honest gaps, not silently
dropped.
