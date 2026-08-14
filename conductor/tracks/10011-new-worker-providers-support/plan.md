# Track 10011: New Worker Providers Support

## Phase 1: Canonical Provider Registry

**Problem**: Nine independent, drifting copies of "what providers exist /
what are their models" exist across `bin/lc.mjs`, `conductor/laneconductor.sync.mjs`,
`ui/server/index.mjs`, and five React components. This is the root cause of
both reported symptoms.

**Solution**: Create one canonical registry module and prove it's reachable
from both runtimes (Node processes, and the Vite-bundled browser app) before
touching any consumer.

- [ ] Create `conductor/providers.mjs` (zero dependencies, matches the
      existing style of `conductor/constants.mjs`) exporting:
  - `PROVIDERS`: `{ claude, gemini, copilot, antigravity }`, each with
    `{ id, label, icon, models: [{id, label}], aliases: [], retired?, retiredMessage? }`.
    Model preset content ports from `ui/src/components/WorkerModelModal.jsx`'s
    existing `MODEL_PRESETS` (already the most complete/current list).
    `antigravity.aliases = ['agy']`. `gemini.retired = true` with the
    existing "Gemini CLI was retired by Google — antigravity is now
    recommended" message (currently only in `bin/lc.mjs`).
  - `PROVIDER_IDS`: `Object.keys(PROVIDERS)` (does not include `'other'`;
    `'other'` stays a free-text escape hatch handled by each consumer, not
    a registry entry).
  - `normalizeProviderId(id)`: resolves a legacy alias (`'agy'`) to its
    canonical id (`'antigravity'`); returns the input unchanged if it's
    already canonical or unrecognized (so `'other'` and free-text ids pass
    through untouched).
  - `providerIcon(id)`, `providerLabel(id)`: lookups with a generic
    fallback (🤖 / the raw id, capitalized) for unrecognized ids — never a
    silent claude-specific fallback.
  - `defaultModelFor(id)`: first entry of that provider's `models` list, or
    `null` if the id isn't recognized (never another provider's model id).
- [ ] Spike: from a throwaway component in `ui/src/`, `import { PROVIDERS } from '../../conductor/providers.mjs'` and run `cd ui && npm run build`.
  - **If it builds cleanly**: this direct import is the approach for every
    UI consumer in Phases 3–4. Delete the throwaway component.
  - **If Vite can't resolve/serve the path** (fs.allow restriction or
    similar): instead create `ui/src/lib/providers.js` as a byte-identical
    copy of `conductor/providers.mjs`'s exports, with a top-of-file comment
    pointing back to the Node original and stating it must be kept in
    sync. Add `conductor/tests/providers-sync.test.mjs` (Node test) that
    imports both files and asserts their `PROVIDERS`/`PROVIDER_IDS` are
    deep-equal, so any future edit to one without the other fails CI
    instead of drifting silently — this is the same failure mode that
    caused this track.
- [ ] Delete the now-redundant preset arrays this phase makes obsolete:
      `conductor/laneconductor.sync.mjs`'s inline `refreshModels()` preset
      object (~lines 419-441) becomes a thin wrapper around
      `PROVIDERS[id].models`.

**Impact**: One authoritative place for provider identity and model
presets. No behavior change yet — Phases 2-4 wire consumers to it.

## Phase 2: Node-side consumers (CLI wizard, sync worker, server)

**Problem**: `bin/lc.mjs`'s setup wizard hardcodes its own agent menu and
writes `'agy'` for Antigravity. `conductor/laneconductor.sync.mjs`'s model
discovery has its own hardcoded `clis` array and duplicate presets, and its
Gemini branch wrongly shells out to `agy models`. `ui/server/index.mjs` has
two more independent lists (`VALID_CLIS` missing `'agy'`, `VALID_AUTHORS`
missing `copilot`/`antigravity`).

**Solution**:

- [ ] `bin/lc.mjs` setup wizard (~lines 832-866): build the "Primary AI
      agent" / "Secondary AI agent" menus from `PROVIDER_IDS` (plus the
      existing `[N] other` option) instead of the hardcoded 4-line list.
      Keep the retired-provider warning, now driven by `PROVIDERS[id].retired`
      / `retiredMessage` instead of an `if (primaryCli === 'gemini')` literal.
      Write `normalizeProviderId(primaryCli)` / `normalizeProviderId(secCli)`
      into `.laneconductor.json` — so choosing Antigravity stores
      `"antigravity"`, not `"agy"`.
  - Keep `runAIAgent`/`callLLMConversational`'s existing
    `cli === 'antigravity' || cli === 'agy'` dispatch check as-is (already
    tolerates both spellings for backward compat with pre-existing configs
    — no change needed here, it's the read side, not the write side).
- [ ] `conductor/laneconductor.sync.mjs`:
  - `discoverAvailableModels(cli)`: call `normalizeProviderId(cli)` first,
    so a legacy `'agy'`-configured project still discovers Antigravity's
    models correctly.
  - Gemini branch (~lines 344-360): remove the `agy models` substitution.
    Try a Gemini-specific discovery command (e.g. the same
    `npx @google/gemini-cli --version`-style invocation already used
    elsewhere in the codebase for reachability checks, adapted for model
    listing) as the live-discovery path; on failure, fall back to
    `PROVIDERS.gemini.models` from the registry. Do not report another
    provider's live output as Gemini's under any fallback path.
  - `refreshModels()`/`cachedModels`: replace the hardcoded `clis` array
    and inline preset object with `PROVIDER_IDS` and `PROVIDERS[id].models`.
- [ ] `ui/server/index.mjs`:
  - `VALID_CLIS` (~line 3096, `PATCH /api/workers/:id/config`): source
    from `PROVIDER_IDS` (plus `'other'`). Normalize the incoming `cli` via
    `normalizeProviderId` before validating/storing, so a client that still
    sends `'agy'` is accepted and canonicalized rather than rejected.
  - Worker self-registration (`POST /worker/register`) and heartbeat PATCH
    (~lines 2955-3062): normalize the reported `cli` via
    `normalizeProviderId` before writing to the `workers` table — this is
    the actual forward-migration point: every worker that registers after
    this change stores the canonical id even if its local `.laneconductor.json`
    still has the legacy `'agy'` from before Phase 2's wizard fix took effect.
  - `VALID_AUTHORS` (~line 2688, `POST /track/:num/comment`): extend to
    `['human', 'system', ...PROVIDER_IDS]` instead of the current
    3-entry list, so Copilot/Antigravity-authored comments are stored
    under their real author instead of downgrading to `'human'`.

**Impact**: Every Node-side write path (setup wizard, worker registration,
comment posting) now agrees on provider identity, and legacy `'agy'` data
keeps working without a migration.

## Phase 3: UI display fixes (the reported symptoms)

**Problem**: `WorkersList.jsx` shows a Claude model string for any worker
with a null `model`, regardless of its actual `cli` — the literal "gemini
has wrong version" bug. Four more components (`WorkerModelModal.jsx`,
`TrackCard.jsx`, `TrackDetailPanel.jsx`, `ProjectConfigSettings.jsx`)
maintain their own partial provider lists.

**Solution**:

- [ ] `ui/src/components/WorkersList.jsx`:
  - Remove the local `CLI_ICONS` object (~lines 23-28); use
    `providerIcon(worker.cli)` from the shared registry.
  - Replace both occurrences of `worker.model || 'claude-3-5-sonnet'`
    (~lines 457, 628) with a provider-aware fallback: show
    `defaultModelFor(worker.cli)` if the provider is recognized, else a
    neutral "not reported yet" label — never a hardcoded Claude model id
    for a non-Claude (or unrecognized) worker.
- [ ] `ui/src/components/WorkerModelModal.jsx`: replace the locally-defined
      `MODEL_PRESETS`/`CLI_ENGINES` (~lines 7-45) with re-exports sourced
      from the shared registry (`PROVIDERS[id].models`, provider list built
      from `PROVIDER_IDS`). Keep exporting `MODEL_PRESETS`/`CLI_ENGINES`
      under their existing names so `ProvisionWorkerModal.jsx`'s existing
      `import { MODEL_PRESETS, CLI_ENGINES } from './WorkerModelModal.jsx'`
      keeps working unchanged.
- [ ] `ui/src/components/TrackCard.jsx`: replace `AGENT_LABELS` (~lines
      126-130) with a lookup through `providerLabel`/`providerIcon`, so
      Copilot/Antigravity get real badges instead of falling through to a
      generic "AI" label.
- [ ] `ui/src/components/TrackDetailPanel.jsx`: replace `AUTHOR_STYLES`
      (~lines 46-50) similarly — keep `human`/`system` as their own
      non-provider entries, resolve any provider id through the registry.
- [ ] `ui/src/pages/ProjectConfigSettings.jsx`: replace the hardcoded
      3-option `<select>` (~lines 142-161, both primary and secondary)
      with `<option>`s generated from `PROVIDER_IDS` (+ the existing
      `other` option) — adds `copilot` and `antigravity` as selectable,
      matching what `WorkerModelModal`/`ProvisionWorkerModal` already offer.

**Impact**: The "gemini has wrong version" symptom is fixed directly, and
the same class of bug is closed off in every other component that displays
a provider badge.

## Phase 4: Provider choice when starting a new worker

**Problem**: The track panel's "Run on worker" → `+ New worker…` option
(`TrackDetailPanel.jsx`'s `handleStartNewWorker`) POSTs to `/workers/start-new`
with no `cli`/`model` at all — the resulting worker always runs whatever
`project.primary.cli` already is. This is the literal "new worker dropdown
doesn't even suggest providers" bug. `ProvisionWorkerModal.jsx` already
solves this same problem for dispatching to a *remote* manager (real
CLI/model `<select>`s), but that component only applies when a manager
exists to dispatch to; a solo/local project spinning up worker #2 on the
same machine has no equivalent picker today.

**Solution**:

- [ ] `bin/lc.mjs`'s `start` command: accept `--cli <id>` and `--model <id>`
      flags that override `project.primary.cli`/`primary.model` for that
      one invocation only (does not rewrite `.laneconductor.json` — this
      worker instance runs a different provider than the project default,
      it doesn't change the default). Normalize the passed id via
      `normalizeProviderId` before use.
- [ ] `ui/server/index.mjs`'s `POST /api/projects/:id/workers/start-new`:
      accept optional `cli`/`model` in the request body; when present,
      forward as `lc start --worker-number N --cli <cli> --model <model>`.
      Omitting them keeps today's behavior (project default) — this is
      additive, not a breaking change to the endpoint's contract.
- [ ] `ui/src/components/TrackDetailPanel.jsx`: when `+ New worker…` is
      selected, if `availableManagers.length > 0` (from the same worker
      list already loaded for the dropdown), open `ProvisionWorkerModal`
      (already imported by `WorkersList.jsx` elsewhere — import it here
      too) instead of calling `handleStartNewWorker()` directly. If there
      is no manager (pure local/solo setup), show a small inline
      provider/model picker (two `<select>`s sourced from `PROVIDER_IDS`/
      `PROVIDERS[id].models`, defaulting to the project's configured
      primary) before calling `handleStartNewWorker(cli, model)`, which now
      forwards the chosen `cli`/`model` in its POST body.

**Impact**: Every "start a new worker" surface in the product — from the
Workers lane (`ProvisionWorkerModal`, already correct) and from a track's
detail panel (previously silent) — now lets the user pick a provider.

## Phase 5: Tests

- [ ] `conductor/tests/providers.test.mjs`: `normalizeProviderId` alias
      resolution (`'agy'` → `'antigravity'`, unknown ids pass through),
      `PROVIDER_IDS` shape, `defaultModelFor`/`providerIcon`/`providerLabel`
      fallback behavior for unrecognized ids.
- [ ] (Only if Phase 1's spike required a mirrored file)
      `conductor/tests/providers-sync.test.mjs`: asserts
      `conductor/providers.mjs` and `ui/src/lib/providers.js` export
      deep-equal `PROVIDERS`/`PROVIDER_IDS`.
- [ ] `ui` Vitest: `WorkersList.jsx` renders a worker with
      `{ cli: 'gemini', model: null }` and asserts the rendered model text
      is not `'claude-3-5-sonnet'` (grid and strip layouts).
- [ ] `ui` Vitest: `ProjectConfigSettings.jsx`'s primary/secondary CLI
      `<select>` contains options for all four providers.
- [ ] `ui` Vitest or supertest: `POST /api/projects/:id/workers/start-new`
      forwards `cli`/`model` from the request body into the spawned `lc
      start` command's args when provided.
- [ ] `ui` Vitest or supertest: `POST /track/:num/comment` with
      `author: 'antigravity'` is persisted as `'antigravity'`, not
      downgraded to `'human'`.
- [ ] Manual verification (recorded in quality-gate, per the `implement`
      skill's real-product-check requirement): start a worker from the
      track panel's `+ New worker…` flow and confirm a provider choice is
      actually presented before the worker starts.
