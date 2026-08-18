# Track 1116: Per-lane provider + live-model picker in Workflow Settings

## Phase 1: Verify current state on `main` post-1111 merge

**Problem**: This spec was written while track 1111 was still merging. Assumptions
about `chosenCli` being project-fixed (never per-lane) and about `workflow.json`'s
shape need re-verification against whatever actually landed, not against the
worktree snapshot seen mid-flight.
**Solution**: Confirm before writing any UI code.

- [x] Task 1: Re-read `conductor/laneconductor.sync.mjs`'s `buildCliArgs` on `main`
      after 1111 merges — confirm `chosenCli` is still resolved from the project's
      fixed `primary.cli`, never from `laneConfig`, and confirm `chosenModel` is
      still `laneConfig.primary_model ?? proj.primary?.model`.
- [x] Task 2: Confirm `conductor/workflow.json` on `main` has `primary_model`
      populated per lane (1111's Phase 1 claim) and note the actual values, so the
      UI's "pre-select existing value" behavior (spec REQ-6) has a real fixture to
      test against.
- [x] Task 3: Record findings in this plan (update this phase's notes) before
      proceeding to Phase 2 — if either assumption changed, update `spec.md`'s
      REQ-4 accordingly first.

**Findings (verified on `main` post-1111 merge, 2026-08-18)**:
- ✅ `chosenCli` in `buildCliArgs` (laneconductor.sync.mjs:4265, via
  `resolveLaneCliAndModel`) is still resolved from `proj.primary?.cli` only —
  never from `laneConfig`. REQ-4's assumption holds; Provider stays a UI-only
  filter, not a new `workflow.json` field.
- ✅ `chosenModel` is still exactly `laneConfig.primary_model ?? proj.primary?.model`
  (`conductor/services/lane-model-resolver.mjs:20`).
- ✅ `conductor/workflow.json` on this branch has `primary_model` populated per
  lane: `plan: claude-opus-5`, `implement: claude-sonnet-5`,
  `review: claude-3-5-haiku`, `quality-gate: claude-3-5-haiku`. Real fixture
  for REQ-6's pre-select test (use `claude-opus-5` on `plan`).
- ⚠️ **Surprising finding, changes framing but not scope**: `ui/src/pages/WorkflowSettings.jsx`
  on this branch has **no "Primary Model" field at all** — free-text or
  otherwise. `git log` on the file shows no commit ever added one; it must not
  have survived the 1111 merge (or was never actually committed in the
  planning session that described it). The per-lane panel currently only has
  Parallel Limit / Max Retries / On Success / On Failure. This track is
  therefore **adding** the Provider+Model picker, not **replacing** a free-text
  input — no regression risk from removing something that isn't there, but
  REQ-6's "must show pre-existing `primary_model` value pre-selected" still
  applies to the field being newly added.

**Impact**: Confirms Phase 2's Provider dropdown is UI-only (as spec REQ-4
assumed) — no new `workflow.json` field. Phase 3 adds the two dropdowns fresh
rather than replacing an existing input.

## Phase 2: Locate and confirm the live-model-source endpoint

**Problem**: `WorkflowSettings.jsx` currently only fetches
`/api/projects/:id/workflow` — it has no worker data. `WorkerModelModal.jsx` reads
`worker.available_models` off a worker object it's already been handed by its
parent (`WorkersList.jsx`), not via its own fetch. This track needs to find the
actual endpoint that lists a project's workers with `available_models` included.
**Solution**: Trace the data flow before designing the fetch.

- [x] Task 1: Read `ui/server/index.mjs` around the `available_models` column
      (referenced at lines ~316, ~384 in earlier grep — re-check line numbers
      after 1111 merges since it touches this same file) to find the exact
      `GET` route and response shape.
- [x] Task 2: Decide fetch strategy in `WorkflowSettings.jsx`: on mount (alongside
      the existing `fetchWorkflow()` call) or lazily when a provider is selected
      in the per-lane panel. Prefer on-mount if the payload is small (matches
      `WorkersList.jsx`'s existing polling pattern) — confirm size/shape first.
- [x] Task 3: Resolve Open Question 2 from spec.md — first-worker-reporting vs.
      merge-across-workers — pick one and document the reasoning here.

**Findings**:
- Endpoint confirmed: `GET /api/projects/:id/workers` (`ui/server/index.mjs:303`)
  returns rows including `cli, model, available_models` already scoped to the
  project. `available_models` is a JSONB column parsed server-side.
- **No new fetch needed.** `App.jsx`'s top-level `usePolling(selectedProjectId)`
  (`ui/src/hooks/usePolling.js:79`) already fetches this exact endpoint into its
  `workers` state on a 2s/30s poll, and `App.jsx` already has `workers` in scope
  at both `<WorkflowSettings>` render sites (line 486) — it's just not passed
  down yet. Simplest, zero-new-network-call fix: add a `workers` prop to
  `WorkflowSettings` and pass `workers={workers}` from `App.jsx`, same as
  `WorkersList`/`ProjectCard` already receive it. Also pass `project={selectedProject}`
  (same object `ConductorPanel`/`ProjectConfigSettings` already receive) so the
  Provider default can read `project.primary_cli`.
- Open Question 2 resolved: **merge across all of the project's workers** for a
  given provider, not just "first worker reporting" — a project can have workers
  on different CLIs (one Claude, one Antigravity), and picking only the first
  worker in array order would silently hide a second worker's live models for
  the same provider whenever it happens to sort after another provider's
  worker. Merging is cheap (workers list is already small, already in memory)
  and strictly more correct.

**Impact**: Phase 3 adds two new props (`workers`, `project`) to
`WorkflowSettings.jsx` instead of a new API call or hook.

## Phase 2b: Shared default-provider/model resolver

**Problem**: `'claude'` (and, in one place, `MODEL_PRESETS.claude[0]`) is
independently hardcoded as the "nothing configured" fallback in 5 places
(`ProjectConfigSettings.jsx:144`, `ProjectCard.jsx:79`, `WorkersList.jsx:456`,
`WorkerModelModal.jsx:20,25`), each blind to the project's actual configured
default and to live discovery data. This track adds a 6th consumer (the new
per-lane picker) — build the shared resolver now instead of a 6th copy.
**Solution**: One function, `getDefaultProviderModel(project, workers)`, per
spec REQ-3's fallback order (project config → live discovery → static registry
recommended slot).

- [x] Task 1: Confirm the exact shape of `project` as available in each of the
      5 existing call sites — some may have the full `.laneconductor.json`
      shape (`project.primary.cli`), others the flattened DB row shape
      (`project.primary_cli`). The resolver needs to handle whichever shape(s)
      are actually passed, not assume one.
- [x] Task 2: Write `ui/src/lib/defaultModel.js` exporting
      `getDefaultProviderModel(project, workers)` implementing spec REQ-3's
      3-tier fallback, reusing `PROVIDERS`/`PROVIDER_IDS` from
      `conductor/providers.mjs` for tier 3.
- [x] Task 3: Update all 5 existing call sites to use the resolver (spec
      REQ-3b) — each is a small diff (replace `|| 'claude'` /
      `MODEL_PRESETS.claude[0]` with a call to the resolver), not a rewrite of
      the surrounding component.
- [x] Task 4: Confirm no behavioral change for the common case (a project with
      `primary_cli` already configured) — tier 1 of the resolver returns
      exactly what the old hardcoded fallback would only have reached in the
      *absence* of configuration, so configured projects are unaffected.

**Impact**: Fixes the 5 pre-existing hardcoded-default sites as a side effect of
building what this track needed anyway; centralizes "what's the recommended
default" behind one resolver + the registry's ordering in `providers.mjs`.

## Phase 3: Provider + Model dropdown UI

**Problem**: Replace the current free-text "Primary Model" input
(`WorkflowSettings.jsx`, per-lane panel) with a two-field picker.
**Solution**: Mirror `WorkerModelModal.jsx`'s existing provider/model selection
pattern rather than inventing a new one.

- [x] Task 1: Add Provider `<select>` (options from `PROVIDER_IDS`/`PROVIDERS`),
      defaulting to the project's configured `primary.cli` if known, else `claude`.
- [x] Task 2: Add Model `<select>` (or datalist, matching existing per-lane field
      conventions in this panel) scoped to the selected provider, sourced from
      Phase 2's live data with static-preset fallback (spec REQ-2).
- [x] Task 3: Wire the lane-has-no-`primary_model` default to Phase 2b's
      `getDefaultProviderModel()` resolver (spec REQ-3c) — not a hardcoded
      `claude-sonnet-5` literal in this component.
- [x] Task 4: Confirm pre-existing `primary_model` values (e.g. `claude-opus-5`)
      still show correctly selected on open (spec REQ-6) — do not regress this.
- [x] Task 5: Preserve existing `updateLaneProp('primary_model', ...)` write path
      and its delete-on-empty behavior for "reset to project default".
- [x] Task 6: Update the "Available Actions" help-box copy for `primary_model` to
      describe the new two-field picker instead of the current free-text
      description.

**Impact**: User-visible change to the Workflow Settings panel; no change to
`workflow.json`'s schema (per spec REQ-4's default assumption, pending Phase 1).

## Phase 3b: Per-track model override (spec REQ-7) + documented limitations (REQ-8)

**Problem**: Precedence has no track dimension — `resolveLaneCliAndModel` is
exactly `laneConfig.primary_model ?? proj.primary?.model`, so there's no way to
say "this one track should use opus even though the implement lane says sonnet".
**Solution**: Add a track-level tier at the top of the same resolver, stored as
a `**Model**:` marker in the track's `index.md` (filesystem-as-API convention).

- [x] Task 1: Extend `resolveLaneCliAndModel` in
      `conductor/services/lane-model-resolver.mjs` to accept a track-level
      model and return `trackModel ?? laneConfig.primary_model ??
      proj.primary?.model` — keep it in this one unit-tested module, don't
      inline it back into buildCliArgs.
- [x] Task 2: Marker plumbing — parse `**Model**: <id>` from `index.md` the
      same way existing markers (`**Lane**`, `**Progress**`) are parsed; sync
      to a nullable column on `tracks`; thread through to the auto-launch /
      buildCliArgs call path in all three worker modes.
- [x] Task 3: Extend the `stripLanePrimaryCli`-style guard to track level — a
      track-level provider override is stripped with a warning, never honored
      (same session-continuity reasoning as 1111's REQ-3).
- [x] Task 4: Minimal UI — optional Model picker on the track detail panel,
      reusing Phase 3's picker component; empty = inherit.
- [x] Task 5: Document REQ-8's two caveats (worker-mode-only; best-effort
      matching, CLI fails the run if the model isn't actually available on the
      executing machine) in the Workflow Settings help box and
      `conductor/workflow.md`'s model-overrides section.
- [x] Task 6: Update `conductor/product.md`'s "Feature Availability —
      Skill-Only vs Worker Modes" table (added during this track's planning):
      flip the "Per-track model override" row from "planned, track 1116" to
      shipped, and re-verify every model-control row's checkmarks still match
      reality after this track's changes.

**Impact**: Full precedence chain becomes track > lane > project, all resolved
in one tested function; limitation caveats are written down where users
configure models instead of being tribal knowledge.

## Phase 4: Tests

**Problem**: No existing test file covers `WorkflowSettings.jsx` at all today.
**Solution**: Add one, following the existing pattern in
`ConductorPanel.test.jsx`/`WorkersList.test.jsx` (mock `useApi`, render, assert on
DOM).

- [x] Task 0: Unit-test `getDefaultProviderModel()` directly (all 3 fallback
      tiers) — the cheapest, most isolated coverage for this track's core new
      logic.
- [x] Task 1: Test default-to-resolver-result when lane has no `primary_model`.
- [x] Task 2: Test pre-existing `primary_model` value shows pre-selected.
- [x] Task 3: Test live `available_models` path (mocked workers fetch) populates
      the Model dropdown with live values, not just presets.
- [x] Task 4: Test fallback-to-presets path when no worker reports live models.
- [x] Task 5: Test save round-trip still writes a plain model-id string to
      `workflow.json` via the existing `POST /api/projects/:id/workflow`.

**Impact**: Closes the test-coverage gap this component has had since its
creation.

## ✅ COMPLETE
