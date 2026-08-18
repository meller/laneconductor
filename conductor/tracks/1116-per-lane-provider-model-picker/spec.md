# Spec: Per-lane provider + live-model picker in Workflow Settings

## Problem Statement
`WorkflowSettings.jsx`'s per-lane panel has no way to set a lane's `primary_model`
at all today — `workflow.json` already supports the field (track 1111 populates
and honors it) but the UI has no control for it. (This spec was originally
written to *replace* a free-text "Primary Model" input added earlier in the same
session; verified at implementation time that the field never actually landed on
`main` — see plan.md Phase 1. The gap this track closes is the same either way:
add the picker.) `WorkerModelModal.jsx` (the worker "Change Model" dialog)
already solves the equivalent problem for workers — it shows a **provider (CLI)
picker** and a **model picker**, and prefers the worker's own live-reported
`available_models` (track 1099) over the static preset list when available. The
new per-lane picker in Workflow Settings should follow that same established
pattern rather than reinventing it.

**Second, related problem found while scoping the above**: the literal string
`'claude'` is independently hardcoded as a "no default set" fallback in at least
five places — `ProjectConfigSettings.jsx:144`, `ProjectCard.jsx:79`,
`WorkersList.jsx:456`, and `WorkerModelModal.jsx:20,25` (the last of these also
hardcodes `MODEL_PRESETS.claude[0]` as the model fallback). Every one of these
reimplements its own version of "what's the default provider/model" with no
awareness of the project's actually-configured default (`.laneconductor.json`'s
`project.primary.cli`/`.model`, mirrored in the `projects` table's `primary_cli`/
`primary_model` columns) or of live discovery data (1099). This track adds a
sixth consumer (the new per-lane picker) — rather than writing a sixth copy of
the same ad-hoc fallback chain, this track also introduces the one shared
resolver the other five should have been using, and updates them to use it.

## Requirements
- **REQ-1**: Replace the free-text "Primary Model" input in `WorkflowSettings.jsx`'s
  per-lane panel with a **Provider** dropdown (sourced from `PROVIDERS`/`PROVIDER_IDS`
  in `conductor/providers.mjs`, same registry `WorkerModelModal.jsx` uses) and a
  **Model** dropdown scoped to the selected provider.
- **REQ-2**: The Model dropdown must prefer live worker-reported `available_models`
  for the selected provider when available, falling back to `PROVIDERS[id].models`
  static presets otherwise — reuse `WorkerModelModal.jsx`'s existing fallback logic
  (`workerModels ? [...workerModels, ...basePresets.filter(...)] : basePresets`)
  rather than reimplementing it independently.
- **REQ-3**: Add a shared `getDefaultProviderModel(project, workers)` resolver
  (new file, likely `ui/src/lib/defaultModel.js`) that returns `{ cli, model }`
  by trying, in order:
  1. The project's configured default — `project.primary_cli`/`primary_model`
     (or `.laneconductor.json`'s `project.primary.cli`/`.model` shape, confirm
     which the API actually returns on the project object at implementation
     time) — this is the real per-project default and today is inconsistently
     read.
  2. If not configured, the first live-discovered model for that provider from
     any project worker's reported `available_models` (1099's data) — a
     genuinely-installed, currently-available model beats a static guess.
  3. If neither is available, the static registry's first entry —
     `PROVIDERS[cli].models[0]` — which is already the "recommended" slot by
     convention (marked with ✨ in `conductor/providers.mjs`, e.g.
     `claude-sonnet-5` today). Provider itself falls back to `'claude'` only at
     this last tier.
  This resolver becomes the single place "Claude / Sonnet 5 today" is decided —
  changing the recommended default later means updating `providers.mjs`'s
  ordering, not hunting down every hardcoded literal.
- **REQ-3b**: Update the 5 existing hardcoded-`'claude'` call sites
  (`ProjectConfigSettings.jsx:144`, `ProjectCard.jsx:79`, `WorkersList.jsx:456`,
  `WorkerModelModal.jsx:20,25`) to call REQ-3's resolver instead of their own
  inline `|| 'claude'` / `MODEL_PRESETS.claude[0]` fallback. Each call site
  needs the `project` object it already has in scope (all 5 are already
  rendered with project context available — verify per-component at
  implementation time rather than assuming) plus the workers list where not
  already present.
- **REQ-3c** (this track's own use of REQ-3): the new per-lane Model dropdown's
  default (when a lane has no `primary_model` configured) is whatever REQ-3's
  resolver returns for this project — expected to be Claude / `claude-sonnet-5`
  under today's registry ordering and no live discovery override, but the UI
  must not hardcode that pairing itself.
- **REQ-4**: Determine (at implementation time, verified against
  `conductor/laneconductor.sync.mjs`, not assumed) whether the Provider selection is
  purely a UI filter for narrowing the Model list, or whether it needs to be
  persisted per lane. Track 1111's own analysis found `chosenCli` in `buildCliArgs`
  is fixed at the **project** level, never per-lane — REQ-4 must confirm this is
  still true on `main` after 1111 merges before deciding the data shape. If still
  true, only `primary_model` (a plain string) is written to `workflow.json` per
  lane, same as today; the Provider dropdown is UI-only, used to pick which
  provider's models to browse, seeded from the project's configured `primary.cli`.
- **REQ-5**: Since `available_models` is reported per-*worker*, not per-project, and
  `WorkflowSettings.jsx` isn't bound to a specific worker: reuse the project's
  workers list — already fetched by `App.jsx`'s `usePolling` hook via
  `GET /api/projects/:id/workers` and passed down as a `workers` prop, same as
  `WorkersList`/`ProjectCard` — and **merge `available_models` across all of the
  project's workers** for the selected provider (resolved at implementation
  time: merging beats "first worker reporting" because a project can have
  workers on different CLIs, and array order shouldn't hide a second worker's
  live models). No live data available → fall back to static presets (REQ-2),
  never block the picker on worker availability. No new network fetch — this
  is a new `workers` (and `project`) prop threaded from `App.jsx`, not a fetch
  inside `WorkflowSettings.jsx` itself.
- **REQ-6**: No regression to existing behavior — a lane with `primary_model`
  already set (e.g. from track 1111's population) must show that value correctly
  pre-selected in the new Model dropdown, and clearing it back to "use project
  default" must still work (mirrors the existing `updateLaneProp` delete-on-empty
  behavior).
- **REQ-7 (per-track model override)**: Support overriding the model for a
  *specific track*, beating both the lane's `primary_model` and the project
  default. Today's precedence in
  `conductor/services/lane-model-resolver.mjs` is exactly two levels
  (`laneConfig.primary_model ?? proj.primary?.model`) with no track dimension.
  Add a track-level tier at the top:
  `trackModel ?? laneConfig.primary_model ?? proj.primary?.model`.
  - **Storage**: a `**Model**: <model-id>` marker in the track's `index.md`
    (following the existing filesystem-as-API marker convention — same
    mechanism as `**Lane**`/`**Progress**`), synced to a nullable
    `tracks.model_override` column like other markers. Confirm marker-parsing
    plumbing details against the sync worker's existing marker table at
    implementation time.
  - **Provider stays fixed** — same rule as lanes (1111's REQ-3 /
    `stripLanePrimaryCli` guard): a per-track override sets the *model only*,
    never the provider, for the same session-continuity reason. Extend the
    strip/warn guard to track-level config too.
  - **Resolver change** lives in `lane-model-resolver.mjs` (extend
    `resolveLaneCliAndModel` to accept a `track` param), keeping the
    precedence rule in the one unit-tested place 1111 extracted it to.
  - **UI**: minimal — an optional Model field on the track detail panel
    (reusing this track's Provider/Model picker component from REQ-1/REQ-2);
    empty = inherit lane/project as today.
- **REQ-8 (documented limitation — worker-mode-only, best-effort)**: Model
  selection (lane-level and REQ-7's track-level alike) is resolved by the
  *worker at spawn time* (`buildCliArgs` passes `--model` when launching the
  CLI). Two consequences this track must document, not fix:
  1. **Skill-only mode is out of scope**: with no worker at all (e.g. Claude
     Desktop driving `conductor/` files directly), nothing spawns per-lane
     sessions — the model is whatever session the human is running, and no
     config here can change it. (All three *worker* modes — local-fs,
     local-api, remote-api — do honor it, since they share `buildCliArgs`.)
  2. **Matching is best-effort**: `--model` is passed through unvalidated
     against the executing worker's `available_models`; a worker that can't
     serve the requested model fails the run at CLI level (then normal
     retry/on_failure handling applies) rather than being prevented from
     claiming the track. Claim-time capability matching is explicitly NOT in
     this track's scope — if wanted later, it belongs in the claim-allowlist
     machinery (tracks 1084/1109) as its own track.
  Record both caveats in the UI help text (the "Available Actions" box) and in
  `conductor/workflow.md`'s model-overrides section so users aren't surprised.

## Acceptance Criteria
- [ ] Opening the per-lane panel in Workflow Settings shows a Provider dropdown and
      a Model dropdown, not a free-text field.
- [ ] Selecting a provider with a worker actively reporting `available_models`
      shows that worker's live model list in the Model dropdown, not just the
      static presets.
- [ ] Selecting a provider with no worker reporting live models falls back to the
      static preset list from `conductor/providers.mjs` without erroring.
- [ ] A lane with no `primary_model` set defaults the Model dropdown to whatever
      `getDefaultProviderModel()` returns for the project (Claude /
      `claude-sonnet-5` under today's registry, verified — not hardcoded in the
      component itself).
- [ ] All 5 previously-hardcoded `'claude'` fallback sites call the shared
      resolver and behave identically to before for projects that already have
      `primary_cli` configured (no behavior change for the common case — only
      the "nothing configured at all" fallback path changes).
- [ ] Saving persists the selected model string into `workflow.json`'s
      `lanes.<lane>.primary_model`, matching the existing (already-shipped) field
      name and precedence logic — no schema change to the config file.
- [ ] A lane with a pre-existing `primary_model` value (e.g. `claude-opus-5` from
      1111's population) opens with that value correctly pre-selected, not reset
      to the default.
- [ ] A track with a `**Model**: <id>` marker in its `index.md` spawns its lane
      actions with that model, beating both the lane's `primary_model` and the
      project default (REQ-7) — verified via the resolver's unit tests plus one
      end-to-end spawn assertion (mock CLI argv contains the track's model).
- [ ] A track-level `primary_cli`/provider override is stripped with a warning,
      never honored (REQ-7's provider-stays-fixed rule).
- [ ] The worker-mode-only + best-effort caveats (REQ-8) appear in the Workflow
      Settings help box and `conductor/workflow.md`.

## API / Data Models
No new fields in `conductor/workflow.json` — `lanes.<lane>.primary_model` remains a
plain model-id string (per REQ-4's default assumption, to be verified). This track
changes the **UI's construction of that value**, not its shape.

REQ-7 adds a per-track model override: `**Model**: <model-id>` marker in the
track's `index.md` (filesystem side) and a nullable `model_override` column on
`tracks` (DB side, exact name/shape confirmed at implementation), threaded into
`resolveLaneCliAndModel` as the highest-precedence tier.

Likely new/reused endpoint: `GET /api/projects/:id/workers` (confirm exact path and
response shape used by `WorkersList.jsx`/`WorkerModelModal.jsx` at implementation
time) — reused to source live `available_models`, not a new endpoint unless the
existing one proves insufficient for this use case (e.g. doesn't scope by project).

## Open Questions — resolved during implementation (2026-08-18)
1. **Resolved**: no new endpoint needed. `App.jsx` already fetches
   `GET /api/projects/:id/workers` via `usePolling` for other components;
   `WorkflowSettings.jsx` gets it as a new `workers` prop instead of its own fetch.
2. **Resolved**: merge `available_models` across all of a project's workers
   (not "first worker reporting") — see REQ-5.
3. **Resolved**: REQ-4's assumption holds verbatim on `main` post-1111 —
   `chosenCli` is still project-fixed, never per-lane (verified against
   `buildCliArgs`/`resolveLaneCliAndModel`, see plan.md Phase 1 findings).
   Separately (not this question, but found during the same verification):
   the "Primary Model" free-text field this spec was written to *replace*
   does not actually exist on `main` — this track adds the Provider+Model
   picker fresh rather than replacing an existing input.
