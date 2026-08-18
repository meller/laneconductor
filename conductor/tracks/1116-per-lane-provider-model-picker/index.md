# Track 1116: Per-lane provider + live-model picker in Workflow Settings

**Lane**: quality-gate
**Lane Status**: running
**Progress**: 100%
**Phase**: Implementation complete — all 6 phases done, 4 test files (18 unit/E2E cases) passing
**Type**: dev
**Summary**: Replace WorkflowSettings.jsx's static Claude-only "Primary Model" text input with a Provider dropdown + live-discovered Model dropdown (sourced the same way WorkerModelModal.jsx does via track…

## Problem
Track 1111 populates `primary_model` per lane in `workflow.json` and wires the sync
worker to honor it, but its own scope explicitly stopped at the config file — no
UI change. Separately, `WorkflowSettings.jsx`'s Visual Editor got a "Primary Model"
field added (this session, on `main`) as a free-text input with a **static**
autocomplete list (`PROVIDERS.claude.models` from `conductor/providers.mjs`),
hardcoded to Claude only.

That's inconsistent with how model selection already works elsewhere in this UI:
`WorkerModelModal.jsx` (the worker "Change Model" dialog) shows a CLI/provider
picker **and** a model picker, where the model list prefers the worker's own
live-reported `available_models` (from track 1099's heartbeat discovery) over the
static preset list. The Workflow Settings per-lane field should follow the same
pattern instead of staying static-Claude-only.

## Solution
- Add a **Provider** selector to the per-lane panel in `WorkflowSettings.jsx`
  (reusing `PROVIDERS`/`PROVIDER_IDS` from `conductor/providers.mjs`, same as
  `WorkerModelModal.jsx`).
- Add a **Model** selector next to it, populated from live `available_models`
  when known, falling back to the static preset list otherwise — same fallback
  logic `WorkerModelModal.jsx` already implements, not a reimplementation.
- **Shared default resolver** (added mid-planning, per user request): a new
  `getDefaultProviderModel(project, workers)` in `ui/src/lib/defaultModel.js`
  is the single place "what's the default provider/model" is decided —
  project's configured `primary.cli`/`.model` first, then live discovery
  (1099), then the registry's recommended entry (`PROVIDERS.claude.models[0]`
  = `claude-sonnet-5` today) as the last resort. Replaces 5 independently
  hardcoded `'claude'` fallbacks found while scoping this track
  (`ProjectConfigSettings.jsx`, `ProjectCard.jsx`, `WorkersList.jsx`,
  `WorkerModelModal.jsx` ×2) — see spec.md REQ-3/REQ-3b/REQ-3c.
- **Provider vs. per-lane storage**: confirm at implementation time whether the
  Provider field is purely a UI filter (picks which provider's models to list,
  since the sync worker's `chosenCli` is fixed at the project level per track
  1111's finding — never per-lane) or whether it should actually be written
  into `workflow.json` per lane. Do not assume; verify against
  `conductor/laneconductor.sync.mjs`'s current `buildCliArgs` behavior on
  `main` post-1111-merge before finalizing the data shape (plan.md Phase 1).

## Phases
- [ ] Phase 1: Verify current state on `main` post-1111 merge
- [ ] Phase 2: Locate and confirm the live-model-source endpoint
- [ ] Phase 2b: Shared default-provider/model resolver
- [ ] Phase 3: Provider + Model dropdown UI
- [ ] Phase 3b: Per-track model override + documented worker-mode/best-effort limitations
- [ ] Phase 4: Tests

## Depends on
[1111](../1111-per-lane-model-stickiness-and-auto-update/index.md) — must merge to `main` first; this track's provider/model UI sits on top of its `primary_model` field and precedence logic.
[1099](../1099-dynamic-worker-model-discovery/index.md) (done) — source of `available_models`, the live model list this track needs to surface.

## Notes
Opened as a plan-only follow-up (explicit user instruction: do not implement
yet) after this session found the just-added static "Primary Model" field
insufficient — user wants Provider + live-discovered Model, matching the
worker "Change Model" modal's existing pattern. Scope widened mid-planning
(still no implementation) when the user flagged that "Claude / Sonnet 5" as a
default shouldn't be hardcoded per-component either — this track now also adds
the shared `getDefaultProviderModel()` resolver and fixes the 5 pre-existing
hardcoded-`'claude'` sites to use it (user chose "fold into 1116" over a
separate track for the resolver).
**Waiting for reply**: no
