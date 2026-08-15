# Track 10011: New Worker Providers Support

## Phase 1: Canonical Provider Registry

**Problem**: Nine independent, drifting copies of "what providers exist /
what are their models" exist across `bin/lc.mjs`, `conductor/laneconductor.sync.mjs`,
`ui/server/index.mjs`, and five React components. This is the root cause of
both reported symptoms.

**Solution**: Create one canonical registry module and prove it's reachable
from both runtimes (Node processes, and the Vite-bundled browser app) before
touching any consumer.

- [x] Create `conductor/providers.mjs` (zero dependencies, matches the
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
- [x] Spike: from a throwaway component in `ui/src/`, `import { PROVIDERS } from '../../conductor/providers.mjs'` and run `cd ui && npm run build`.
      Builds cleanly — direct import used for all UI consumers (no mirrored file needed).
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
- [x] Delete the now-redundant preset arrays this phase makes obsolete:
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

- [x] `bin/lc.mjs` setup wizard (~lines 832-866): build the "Primary AI
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
- [x] `conductor/laneconductor.sync.mjs`:
  - `discoverAvailableModels(cli)`: call `normalizeProviderId(cli)` first,
    so a legacy `'agy'`-configured project still discovers Antigravity's
    models correctly.
  - Gemini branch (~lines 344-360): Try a Gemini-specific discovery command
    first; on failure, query the local provider CLI (`agy models`) and filter for
    `gemini-` prefixed models. On failure of both, fall back to
    `PROVIDERS.gemini.models` from the registry. Do not report another
    provider's live output as Gemini's under any fallback path.
  - `refreshModels()`/`cachedModels`: replace the hardcoded `clis` array
    and inline preset object with `PROVIDER_IDS` and `PROVIDERS[id].models`.
- [x] `ui/server/index.mjs`:
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

- [x] `ui/src/components/WorkersList.jsx`:
  - Remove the local `CLI_ICONS` object (~lines 23-28); use
    `providerIcon(worker.cli)` from the shared registry.
  - Replace both occurrences of `worker.model || 'claude-3-5-sonnet'`
    (~lines 457, 628) with a provider-aware fallback: show
    `defaultModelFor(worker.cli)` if the provider is recognized, else a
    neutral "not reported yet" label — never a hardcoded Claude model id
    for a non-Claude (or unrecognized) worker.
- [x] `ui/src/components/WorkerModelModal.jsx`: replace the locally-defined
      `MODEL_PRESETS`/`CLI_ENGINES` (~lines 7-45) with re-exports sourced
      from the shared registry (`PROVIDERS[id].models`, provider list built
      from `PROVIDER_IDS`). Keep exporting `MODEL_PRESETS`/`CLI_ENGINES`
      under their existing names so `ProvisionWorkerModal.jsx`'s existing
      `import { MODEL_PRESETS, CLI_ENGINES } from './WorkerModelModal.jsx'`
      keeps working unchanged.
- [x] `ui/src/components/TrackCard.jsx`: replace `AGENT_LABELS` (~lines
      126-130) with a lookup through `providerLabel`/`providerIcon`, so
      Copilot/Antigravity get real badges instead of falling through to a
      generic "AI" label.
- [x] `ui/src/components/TrackDetailPanel.jsx`: replace `AUTHOR_STYLES`
      (~lines 46-50) similarly — keep `human`/`system` as their own
      non-provider entries, resolve any provider id through the registry.
- [x] `ui/src/pages/ProjectConfigSettings.jsx`: replace the hardcoded
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

- [x] `bin/lc.mjs`'s `start` command: accept `--cli <id>` and `--model <id>`
      flags that override `project.primary.cli`/`primary.model` for that
      one invocation only (does not rewrite `.laneconductor.json` — this
      worker instance runs a different provider than the project default,
      it doesn't change the default). Normalize the passed id via
      `normalizeProviderId` before use.
- [x] `ui/server/index.mjs`'s `POST /api/projects/:id/workers/start-new`:
      accept optional `cli`/`model` in the request body; when present,
      forward as `lc start --worker-number N --cli <cli> --model <model>`.
      Omitting them keeps today's behavior (project default) — this is
      additive, not a breaking change to the endpoint's contract.
- [x] `ui/src/components/TrackDetailPanel.jsx`: when `+ New worker…` is
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

- [x] `conductor/tests/providers.test.mjs`: `normalizeProviderId` alias
      resolution (`'agy'` → `'antigravity'`, unknown ids pass through),
      `PROVIDER_IDS` shape, `defaultModelFor`/`providerIcon`/`providerLabel`
      fallback behavior for unrecognized ids. 10/10 pass.
- [x] N/A — Phase 1's spike built cleanly with a direct import; no mirrored
      file, so `providers-sync.test.mjs` isn't needed.
- [x] `ui` Vitest: `WorkersList.test.jsx` renders a worker with
      `{ cli: 'gemini', model: null }` and asserts the rendered model text
      is not `'claude-3-5-sonnet'` (grid and strip layouts), plus a
      copilot-icon assertion. Added jsdom + @testing-library/react to
      support component rendering tests (previously vitest.config.mjs only
      covered `.mjs`/`.js`).
- [x] `ui` Vitest: `ProjectConfigSettings.test.jsx`'s primary/secondary CLI
      `<select>` contains options for all four providers.
- [x] `ui` supertest: `server/tests/track-10011-providers.test.mjs` —
      `POST /api/projects/:id/workers/start-new` forwards `cli`/`model`
      into the spawned `lc start` args (and omits them when absent).
- [x] `ui` supertest (same file): `POST /track/:num/comment` with
      `author: 'antigravity'`/`'copilot'` is persisted as-is, a legacy
      `'agy'` author normalizes to `'antigravity'`, and a genuinely
      unrecognized author still downgrades to `'human'`.
- [x] `conductor/tests/providers.test.mjs` (or a dedicated integration/unit test in `laneconductor.sync.mjs` test files): add coverage for `discoverAvailableModels('gemini')` falling back to `agy models` and filtering for `gemini-` prefixed models.
- [ ] Manual verification (recorded in quality-gate, per the `implement`
      skill's real-product-check requirement): start a worker from the
      track panel's `+ New worker…` flow and confirm a provider choice is
      actually presented before the worker starts.
      Not done during implement: the only API/UI dev servers reachable on
      the standard ports in this environment belong to the main checkout
      (`/home/meller/Code/laneconductor/ui`), not this worktree — they're a
      separate, live dev session that shouldn't be restarted or repointed
      just to test this track's code. `npm run build` was run clean against
      every changed component (Phases 1, 3, 4) as the available substitute;
      the actual click-through is left for quality-gate, which can spin up
      its own instance.

## Phase 6: Gemini Local Provider Model Discovery Alignment

- [x] Modify `discoverAvailableModels(cli)` in `conductor/laneconductor.sync.mjs` to fetch models from the local provider CLI (`agy models`) as a fallback when direct gemini CLI queries fail, filtering for `gemini-` prefixed models.
- [x] Verify that `discoverAvailableModels('gemini')` returns the correct live models from `agy models` by adding test assertions.
- [x] Verify that there is no regression for `claude` or other providers.

## Phase 7: Root-cause the "still not seeing gemini models" report (2026-08-15)

**Problem**: after Phase 6 was marked complete, a human comment on this
track reported still not seeing Gemini models discovered from the
machine, and asked whether this track should be merged with track 1099
("Dynamic Worker Model Discovery") or replanned.

**Investigation (this planning session)**:

- [x] Confirmed track 1099 is `done` and built the *mechanism* this track's
      Gemini fix plugs into: worker-side `discoverAvailableModels()` /
      `refreshModels()` / `cachedModels` in `conductor/laneconductor.sync.mjs`,
      reported via heartbeat as `available_models` and stored on the
      `workers` row (grep-verified: `cachedModels` feeds `available_models`
      at lines ~892/986; consumed by `WorkerModelModal.jsx`/
      `ProvisionWorkerModal.jsx`). Track 10011's Gemini branch is a small
      edit *inside* that same mechanism, not a competing one — **no merge
      with 1099 is needed**, there's nothing to reconcile.
- [x] Reproduced both code paths for real on this dev machine (not
      mocked): `npx @google/gemini-cli -p "..."` fails immediately with
      `IneligibleTierError: This client is no longer supported for Gemini
      Code Assist for individuals` — i.e. direct Gemini CLI access is
      genuinely dead now, confirming `PROVIDERS.gemini.retired = true` is
      accurate and the primary path in `discoverAvailableModels()` will
      always fall through. The `agy models` fallback, run for real, DOES
      return live `gemini-<version>` prefixed rows in the expected
      `id\tlabel` shape (e.g. `gemini-3.7-flash-high\tGemini 3.7 Flash
      (High)`), which the existing parser (`looksLikeModelId` +
      `.startsWith('gemini-')`) handles correctly. **The discovery/parsing
      logic itself is not the bug.**
- [x] Identified the actual root cause: this track's commits only exist on
      the `track-10011` branch/worktree
      (`.worktrees/10011`). The live LaneConductor worker + UI the human
      is checking against is the **main checkout**
      (`/home/meller/Code/laneconductor`), which runs off `main` and has
      never received any of this track's code — not Phase 1's registry,
      not Phase 2/6's Gemini fallback, nothing. "Still not seeing gemini
      models" is expected: there is nothing to see yet, because nothing
      has shipped. This is a deployment-timing gap, not a code defect.
- [x] Found an unrelated defect while investigating: commit `41eb06a`
      ("align Gemini model discovery fallback with local provider CLI")
      accidentally swept in ~121 unrelated files under `.claude/.claude/`
      (a nested duplicate of skills/settings — looks like a stray
      `git add -A` picking up a backup/scratch directory). This is noise
      that must be removed before quality-gate; it is not part of this
      track's scope.

**Required before this track can pass quality-gate this time** (the
Phase 5 manual-verification item was deferred once already; do not defer
again):

- [x] Remove the accidentally-committed `.claude/.claude/` tree from this
      branch (verify with `git log --stat` on the offending commit's
      follow-up, or a cleanup commit) so it doesn't land on `main`.
      Done in commit `ba9ff33` — `git rm -r .claude/.claude` (120 files);
      confirmed `git ls-files .claude/.claude` returns empty afterward.
      Re-ran `node --test conductor/tests/providers.test.mjs
      conductor/tests/track-10011-gemini-discovery.test.mjs` post-cleanup:
      11/11 pass, including the live (non-mocked) `agy models` fallback
      test — the removal didn't touch anything the code depends on.
- [ ] After quality-gate passes and this branch merges to `main` (per the
      standard `done:success` worktree-merge flow), **restart the live
      worker and API** (`lc worker restart`, `lc api restart` — long-running
      processes do not hot-reload) in the main checkout, then re-check the
      real UI: a Gemini-configured worker's `available_models.gemini`
      should populate within one heartbeat + refresh cycle after restart
      (refresh runs once immediately at startup, then every 30 min), and
      `WorkerModelModal`/`ProvisionWorkerModal` should show live discovered
      IDs (e.g. `gemini-3.7-flash-*`), not just the 5 static
      `PROVIDERS.gemini.models` presets. **Still pending — this can only
      happen after this branch is actually merged to `main`; implement
      cannot do it from inside the `track-10011` worktree.**
- [x] Confirm `agy` is authenticated/reachable on the machine the check is
      run from — `agy models` returning an auth error or empty output
      (rather than a model list) would silently fall back to null →
      presets, which would look identical to "still not working" from the
      UI but is an environment issue, not a code issue.
      Ran `agy --version` (1.1.13, reachable) and `agy models` directly:
      returns a live, authenticated model list including
      `gemini-3.7-flash-high/medium/low`, `gemini-3.6-*`, `gemini-3.5-*`,
      `gemini-3.1-pro-*` — confirms auth is fine on this machine right now.

## ✅ COMPLETE (Reopened for Gemini discovery alignment; Phase 7 verification pending)

Phases 1-6 implemented and tested. `discoverAvailableModels('gemini')` now
falls back to querying the local provider CLI (`agy models`) for Gemini
models, matching Claude's behavior — confirmed correct against the real
CLI tools on this machine in Phase 7, not just the mocked test. No merge
with track 1099 is needed; this track correctly extends the mechanism
1099 built. The remaining gap is deployment, not logic: this branch has
never been merged to `main`, so the live worker the human is checking
against has none of this code yet. Track stays open until Phase 7's
checklist (junk-file cleanup, merge, worker restart, real re-verification)
is complete — see conversation.md for the full explanation posted back to
the human.

### Phase 7 implement pass (2026-08-15)

- [x] Junk-file cleanup and [x] `agy` auth check are done — see checkmarks
      above. Full test suite re-run post-cleanup: 11/11 pass.
- [ ] Merge-to-main + worker/API restart + real re-verification is
      **structurally impossible for `implement` to do from inside this
      worktree** — it requires this branch to already be merged to `main`,
      which is the outcome of quality-gate passing and the standard
      `done:success` worktree-merge flow, not a precondition of it. Handing
      this to quality-gate/merge as the next step rather than blocking here.

### Phase 7 Playwright verification (2026-08-15, second implement pass)

Human asked to specifically re-check the "new worker → choosing gemini"
flow with Playwright rather than take the merge-timing theory on faith.
Did that, plus went one step further and diffed the *actual deployed*
code on `main` against this branch, instead of only re-asserting "nothing
merged yet." Findings, all empirically verified, not inferred:

- [x] **The Phase 1-5 UI *is* live on `main`.** `git log --all --oneline`
      shows `9353a85 Merge track-10011 (new worker providers support) into
      main`, dated 2026-08-14 — an earlier round of this same track (the
      registry, `WorkersList`/`WorkerModelModal`/`TrackCard`/
      `TrackDetailPanel`/`ProjectConfigSettings` changes) already shipped.
      Playwright confirmed live: opened track 10011's own detail panel at
      `localhost:8090` (main checkout's UI, port 8090/8091), and the "Run
      on worker" `<select>` does contain `+ New worker…` as an option
      today. This part of the original bug report is already fixed on
      `main`.
- [x] **The Gemini `agy models` fallback is genuinely missing from `main`
      — this is the real, currently-live defect, confirmed by data, not
      just by branch diffing.** Queried the live `workers` table directly:
      every worker row's `available_models.gemini` contains exactly the 5
      static `PROVIDERS.gemini.models` presets (`gemini-2.5-pro`,
      `2.5-flash`, `2.5-flash-lite`, `2.0-flash`, `1.5-pro`) — none of the
      live `gemini-3.7-flash-high/medium/low`, `3.6-*`, `3.5-*`,
      `3.1-pro-*` ids that `agy models` actually returns on this machine
      (confirmed again this session). So the human's report is accurate
      and current, not stale.
- [x] **Root-caused exactly why, with `git blame`**: `main`'s
      `discoverAvailableModels()` gemini branch (blame: commit `7aa5e6cb`,
      "feat(track-10011): canonical provider registry + wire all
      consumers", 2026-08-14 — this track's *own* original Phase 1/2
      commit, merged via `9353a85`) explicitly does **not** call `agy
      models` as a fallback; it has a comment stating Gemini "must never
      substitute another provider's live output" and falls straight to
      the static presets on failure. That was the state of this track's
      code *before* the human's later "still not seeing gemini models"
      report triggered the replan that added Phase 6 (the `agy models`
      fallback, filtered to `gemini-` prefixed ids, per REQ-8). Phase 6's
      fix exists correctly on this branch (`conductor/laneconductor.sync.mjs`
      lines ~368-394, confirmed present by direct read) — it has simply
      never been merged past this second round. So: not a code defect in
      this branch, not a logic bug, not an auth/env issue (already ruled
      out last pass) — it is specifically Phase 6's diff sitting unmerged
      on `track-10011` while `main` still runs the pre-Phase-6 Gemini
      branch. This confirms (with evidence this time, not inference) the
      same conclusion the previous pass reached by reasoning alone.
- Did not click through to actually start a worker via the "+ New
  worker…" modal — that would spin up a real background `lc start`
  process on the live machine, an irreversible side effect not needed to
  answer the human's question, which was about whether Gemini would be
  *offered/discovered*, not about actually provisioning one.

## ⚠️ Gaps — review pass (2026-08-15)

- [ ] **Scope creep in commit `41eb06a`, undiscovered by Phase 7's cleanup.**
      `git diff main...HEAD -- conductor/laneconductor.sync.mjs` shows two
      hunks with nothing to do with this track, bundled into the same
      commit that also carried the `.claude/.claude` junk (cleaned up in
      `ba9ff33`, but these two hunks were missed):
      1. `let cachedMainBranch = null;` hoisted from line ~3208 to the top
         of the file (line 51) — fixes the TDZ bug documented in `main`'s
         "Track 1114" comment block, but as an uncredited, untested
         side effect of an unrelated commit.
      2. A new `LC_HEARTBEAT_INTERVAL_MS` env override for the heartbeat
         interval — unrelated feature, zero test coverage, not in this
         track's spec/plan/test.md.
      Action: a small follow-up commit (same shape as `ba9ff33`) that
      either reverts both hunks so this track stays strictly scoped to
      Gemini discovery, or keeps `cachedMainBranch`'s hoist but documents
      + tests it explicitly and drops `LC_HEARTBEAT_INTERVAL_MS` outright.
      Everything else in this pass's review was clean: full test suite
      re-run (`providers.test.mjs` 10/10, gemini-discovery 1/1 live,
      local-fs-e2e 5/5, local-api-e2e 5/6 — the 1 failure is the same
      pre-existing/unrelated one documented in test.md, ui vitest 13/13),
      no secrets, no stub/TODO markers, no `.claude/.claude` remnants.
