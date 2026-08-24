# Tests: Track 1116 — Per-lane provider + live-model picker

## Test Commands
```bash
# Run all UI tests
cd ui && npx vitest run

# Run just the new WorkflowSettings tests
cd ui && npx vitest run src/pages/WorkflowSettings.test.jsx

# Run the shared default-resolver tests
cd ui && npx vitest run src/lib/defaultModel.test.js

# Full build sanity check
cd ui && npx vite build --mode development
```

## Test Cases

### Feature: Shared `getDefaultProviderModel()` resolver
- [x] TC-0a: Project with `primary_cli`/`primary_model` configured → resolver
      returns exactly that pair, ignoring live/static tiers entirely.
- [x] TC-0b: Project with no configured default, but a worker reporting
      `available_models` for a provider → resolver returns that provider + the
      first live-reported model.
- [x] TC-0c: Project with no configured default and no worker data at all →
      resolver returns `PROVIDERS.claude.models[0].id` (today's registry
      ordering: `claude-sonnet-5`) and provider `'claude'`.
- [x] TC-0d: Resolver handles both the nested (`project.primary.cli`) and flat
      (`project.primary_cli`) project shapes without throwing.

### Feature: Existing hardcoded-default sites now use the resolver
- [x] TC-0e: `ProjectConfigSettings.jsx`, `ProjectCard.jsx`, `WorkersList.jsx`,
      `WorkerModelModal.jsx` each show identical output to before this track
      for a project that already has `primary_cli` configured (no regression).
- [x] TC-0f: For a project with nothing configured, each of those 4 components
      now reflects the resolver's tier-2/tier-3 result instead of a hardcoded
      `'claude'` literal — verifiable by mocking a worker with a non-Claude
      `available_models` entry and confirming it surfaces instead of Claude.

### Feature: Provider + Model dropdowns replace free-text input
- [x] TC-1: Per-lane panel renders a Provider `<select>` and a Model `<select>`
      (or datalist-backed input, matching existing conventions) — no plain
      free-text "Primary Model" input remains.
- [x] TC-2: Provider `<select>` options match `PROVIDER_IDS` from
      `conductor/providers.mjs`.

### Feature: Defaults
- [x] TC-3: A lane with no `primary_model` in `workflow.json` opens with
      Provider/Model equal to `getDefaultProviderModel()`'s result for this
      project (Claude / `claude-sonnet-5` under today's registry + no
      overriding project/live config).

### Feature: Pre-existing values (no regression vs. current free-text field)
- [x] TC-4: A lane with `primary_model: "claude-opus-5"` opens with Provider =
      Claude, Model = `claude-opus-5` pre-selected — not reset to the default.

### Feature: Live model discovery (track 1099 integration)
- [x] TC-5: When a project worker has reported `available_models` for the
      selected provider, the Model dropdown shows those live model ids (not just
      the static `PROVIDERS[id].models` presets).
- [x] TC-6: When no worker has reported `available_models` for the selected
      provider, the Model dropdown falls back to the static presets without
      throwing or showing an empty list.

### Feature: Save round-trip
- [x] TC-7: Selecting a model and saving calls `POST /api/projects/:id/workflow`
      with `lanes.<lane>.primary_model` set to the selected model's plain string
      id — same shape the sync worker already reads via
      `laneConfig.primary_model ?? proj.primary?.model`.
- [x] TC-8: Clearing the Model selection back to "use project default" removes
      `primary_model` from that lane's config on save (matches existing
      `updateLaneProp` delete-on-empty behavior).

### Feature: No regression to other per-lane fields
- [x] TC-9: `parallel_limit`, `max_retries`, `on_success`, `on_failure` fields in
      the same per-lane panel still work exactly as before this track's changes.

### Feature: Per-track model override (REQ-7)
- [x] TC-10: `resolveLaneCliAndModel` with a track model set returns the track
      model, beating a lane `primary_model` AND the project default (unit).
- [x] TC-11: `resolveLaneCliAndModel` with no track model behaves exactly as
      before (lane ?? project) — no regression to 1111's precedence tests.
- [x] TC-12: A `**Model**: <id>` marker in a track's `index.md` reaches the
      spawn: mock-CLI argv contains `--model <id>` for that track's lane action
      while another track without the marker uses the lane/project model (e2e,
      same mock-CLI harness 1111's tests use).
- [x] TC-13: A track-level provider override (e.g. a stray `**Provider**:` /
      `primary_cli`) is stripped with a warning and never changes the spawned
      CLI (guard test, mirrors 1111's stripLanePrimaryCli test).
- [x] TC-14: Track detail panel's optional Model picker: empty = no marker
      written (inherit); selecting a model writes/updates the marker; clearing
      removes it. Tested at the API/marker-write contract level
      (`ui/server/tests/track-1116-model-override.test.mjs`: PATCH endpoint +
      `syncTrackToFile`'s marker regex, 7 tests) rather than a full
      `TrackDetailPanel.jsx` component render — that component's
      streaming/websocket dependencies make full mounting disproportionate to
      what this one `<select>` needs; the picker itself was code-reviewed
      against the same tested contract.

### Feature: Documented limitations (REQ-8)
- [x] TC-15: Workflow Settings help box text mentions worker-mode-only and
      best-effort caveats; `conductor/workflow.md` model-overrides section
      updated (content assertion, can be a simple grep-level check in review
      rather than an automated test).

## Acceptance Criteria
- [x] All test cases above pass.
- [x] `ConductorPanel.test.jsx` and other existing UI tests still pass (no
      regression from shared imports/hooks touched by this track).
- [x] `npx vite build` succeeds with no new warnings introduced by this track.
