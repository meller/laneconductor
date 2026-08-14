# Spec: New Worker Providers Support

## Problem Statement

LaneConductor supports four worker providers (`claude`, `gemini`, `copilot`,
`antigravity`), but there is no single source of truth for that list. Nine
independent copies of "which providers exist / what are their models" are
hardcoded across the codebase, and they have drifted:

1. **`ui/src/components/WorkersList.jsx`** (worker-lane badges, both grid
   and strip layouts) falls back to the literal string
   `worker.model || 'claude-3-5-sonnet'` whenever a worker's `model` column
   is null — so a Gemini worker with no reported model shows the label
   "gemini" next to the version "claude-3-5-sonnet". This is the reported
   "gemini has wrong version in worker lane" bug.
2. **`ui/src/components/TrackDetailPanel.jsx`**'s "Run on worker" dropdown
   has a `+ New worker…` option that calls `handleStartNewWorker()`, which
   POSTs to `/api/projects/:id/workers/start-new` with **no `cli`/`model`
   in the body at all**. The server just runs `lc start --worker-number N`,
   which always uses whatever `project.primary.cli` is already sitting in
   `.laneconductor.json` — there is no provider choice in this flow at all.
   This is the reported "new worker dropdown doesn't even suggest
   providers" bug.
3. Three more UI lists (`ProjectConfigSettings.jsx`'s primary/secondary CLI
   `<select>`, `TrackCard.jsx`'s `AGENT_LABELS`, `TrackDetailPanel.jsx`'s
   `AUTHOR_STYLES`) hardcode only `claude`/`gemini`(/`other`) and silently
   omit `copilot`/`antigravity` as options entirely.
4. The CLI setup wizard (`bin/lc.mjs`) stores Antigravity's provider id as
   `'agy'`, while every other list in the codebase (UI components, the
   sync worker's model-discovery code, the server's `VALID_CLIS`) keys off
   `'antigravity'`. A worker set up via the wizard's Antigravity option
   therefore fails to match its own icon/model-preset lookups everywhere
   else.
5. `conductor/laneconductor.sync.mjs`'s real-model-discovery code
   (`discoverAvailableModels`) has a `gemini` branch that shells out to
   `agy models` instead of a Gemini-specific command, per an explicit
   "on this system" comment — baking one developer's local environment
   into shared code, so Gemini's *live discovered* models can silently be
   Antigravity's models instead.
6. The server's `VALID_CLIS` (used to validate `PATCH
   /api/workers/:id/config`) and `VALID_AUTHORS` (used to validate `POST
   /track/:num/comment`) are two more independent copies, and don't agree
   with each other or with the UI's list (`VALID_CLIS` excludes `'agy'`;
   `VALID_AUTHORS` excludes `copilot`/`antigravity` entirely, silently
   downgrading their comments to `author: 'human'`).

Net effect: any provider other than Claude is a second-class citizen
throughout the product, in exactly the two ways the user hit it (wrong
version badge, and no provider choice when starting a new worker), plus
several more that are part of the same root cause.

## Root Cause

No canonical registry of "what providers exist, what are their display
names/icons, what are their known models, what are their accepted id
aliases." Every consumer (CLI wizard, sync worker, Express server, five
separate React components) independently hardcodes its own partial,
drifting copy.

## Requirements

- REQ-1: A single canonical provider registry exists (`conductor/providers.mjs`)
  listing every supported provider (`claude`, `gemini`, `copilot`,
  `antigravity`) with: canonical id, display label, icon, known model
  presets, and any accepted legacy id aliases (`'agy'` → `'antigravity'`).
- REQ-2: Every Node-side consumer (`bin/lc.mjs`'s setup wizard,
  `conductor/laneconductor.sync.mjs`'s model discovery/presets,
  `ui/server/index.mjs`'s `VALID_CLIS`/`VALID_AUTHORS`) reads from that
  registry instead of maintaining its own list.
- REQ-3: Every browser-side consumer (`WorkersList.jsx`, `WorkerModelModal.jsx`,
  `ProvisionWorkerModal.jsx`, `TrackCard.jsx`, `TrackDetailPanel.jsx`,
  `ProjectConfigSettings.jsx`) reads from the same registry data (via a
  direct import if the build allows it, or a verified byte-identical
  mirror with an automated drift check if it doesn't — see plan.md Phase 1).
- REQ-4: A worker whose `model` is not yet known (null) never displays
  another provider's model string. The badge/label reflects the worker's
  actual `cli`, with a provider-neutral "not reported yet" state (or that
  provider's own recommended default) when `model` is null — never a
  Claude-specific literal.
- REQ-5: `.laneconductor.json`/DB rows are written with the canonical
  provider id (`'antigravity'`, not `'agy'`) going forward; existing rows
  or requests carrying the legacy `'agy'` id continue to resolve correctly
  (icon, models, validation) via the registry's alias resolution — no data
  migration required.
- REQ-6: The "+ New worker…" action reachable from a track's "Run on
  worker" dropdown lets the user choose a provider (and model) before the
  worker is created, instead of silently creating a worker on the
  project's already-configured default provider with no choice offered.
- REQ-7: `ProjectConfigSettings.jsx`'s primary/secondary CLI dropdowns
  offer all four registry providers (currently missing `copilot` and
  `antigravity`).
- REQ-8: `conductor/laneconductor.sync.mjs`'s Gemini model-discovery branch
  queries the local provider CLI (`agy models`) as a fallback when direct gemini
  CLI queries fail (filtering for `gemini-` prefixed models), matching Claude's
  fallback behavior, so that live Gemini versions are discovered in environments
  using Antigravity.

## Acceptance Criteria

- [ ] Given a worker with `cli: 'gemini'` and `model: null`, the Workers
      lane badge (both grid and strip layouts) shows a Gemini icon/label
      and does **not** show `claude-3-5-sonnet` or any other Claude model
      string.
- [ ] From a track's detail panel, clicking "Run on worker" → `+ New
      worker…` presents a provider (and model) choice before any worker is
      created — the user can pick `claude`, `gemini`, `copilot`, or
      `antigravity`, not just get whatever the project's default already is.
- [ ] `lc setup`'s agent-selection step, when the user picks Antigravity,
      results in `.laneconductor.json` storing `"cli": "antigravity"` (not
      `"agy"`), and that worker's icon/model list render correctly
      everywhere in the UI without special-casing.
- [ ] A project's `.laneconductor.json`/DB row that still has the legacy
      `"cli": "agy"` (from before this fix) continues to display the
      correct Antigravity icon and model presets — no manual migration
      needed.
- [ ] `ProjectConfigSettings.jsx`'s Primary/Secondary CLI dropdowns list
      `claude`, `gemini`, `copilot`, and `antigravity` as options.
- [ ] Running `conductor/laneconductor.sync.mjs`'s Gemini model discovery
      queries the local provider CLI (`agy models`) on failure of the direct
      gemini command, filtering for `gemini-` prefixed models so that live
      gemini versions are fetched.
- [ ] Posting a comment as `author: 'copilot'` or `author: 'antigravity'`
      via `POST /track/:num/comment` is accepted and stored as that
      author, not silently downgraded to `'human'`.
- [ ] All unit/integration tests pass; no regressions in existing worker
      or track-panel tests.

## Data Model Changes

None. `workers.cli`, `workers.model`, `projects.primary_cli`,
`projects.secondary_cli` remain plain nullable `TEXT` columns — validation
and canonicalization happen at the application layer via the new registry,
not via a DB constraint (a DB CHECK/enum would need a migration every time
a provider is added, which the app-level registry avoids).
