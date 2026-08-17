# Track 1077: Migrate Gemini CLI support to Antigravity

## Phase 1: `bin/lc.mjs` setup wizard — deprecation signal

**Problem**: the primary/secondary agent menus (~line 671-696) present `gemini` as a plain,
equal option alongside `claude` and `antigravity (agy)`, with no indication it's a retired
product, and no warning when chosen.
**Solution**: label it retired in the menu text and print a warning after selection.

- [x] Update both menu prompt strings: `[3] gemini` → `[3] gemini (retired — use antigravity)`
- [x] After resolving `primaryCli`/`secCli`, if the resolved value is `'gemini'`, print:
      `⚠️  Gemini CLI was retired by Google — antigravity (agy) is now recommended. Continuing with gemini; switch later with: lc config project.primary.cli agy` (adjust path for secondary: `project.secondary.cli`)
  - Non-blocking — do not prompt for confirmation, do not abort.
- [x] Verify the secondary-agent default (`secAgentChoice = primaryCli === 'claude' ? '2' : '1'`) still defaults to antigravity (option `'2'`) when primary is claude — confirmed unchanged (line untouched).

**Impact**: `lc setup`'s interactive wizard nudges new setups away from gemini without
breaking anyone who deliberately picks it.

## Phase 2: `SKILL.md` documentation sync

**Problem**: `/laneconductor setup collection` step 4 (agent reachability + model discovery
tables) only documents `claude` / `gemini` / `other` — doesn't mention `agy`/antigravity at
all, despite it already being a real menu option in `bin/lc.mjs`. The doc has drifted from
the implementation.
**Solution**: add an `agy` row to both tables, annotate `gemini` as retired.

- [x] Reachability-check table: added an `antigravity/agy` row (`agy --version`), annotated
      the `gemini` row as retired.
- [x] Model-discovery table: added an `agy` row following the `other` row's pattern (ask user
      for a model name — no known non-interactive discovery command for `agy` today).
- [x] Updated the "Primary agent" and "Secondary agent" summary lines to list all 4 real
      options (`claude` / `antigravity (agy)` / `gemini (retired)` / `other`), matching
      `bin/lc.mjs`'s actual menu.
- [x] Bonus consistency fixes found while syncing: the `local-api` example `.laneconductor.json`
      snippet had `"secondary": { "cli": "gemini", ... }` — changed to `"agy"` to match the
      wizard's own default-to-antigravity behavior; the "Check Binaries" env-verification line
      and the DB schema reference's `primary_cli` comment both only listed `claude`/`gemini` —
      added `agy` to both for consistency.

**Impact**: the skill doc (which is what an AI agent reads to run `/laneconductor setup
collection` in Skill-Only mode, and what any human reads to understand the wizard) matches
what `lc setup` actually does today.

## Phase 3: Verify

- [x] `node --check bin/lc.mjs` — passes.
- [x] **Full interactive wizard walkthrough was not viable in this environment**: reproduced
      with a minimal, unrelated readline+piped-stdin repro script that sequential
      `rl.question()` calls hang after the first when stdin is a non-TTY pipe in this sandbox
      — a pre-existing environment limitation, not something introduced by this change.
- [x] Verified the actual branching logic instead, in isolation: extracted the exact
      `agentMap` resolution + `primaryCli === 'gemini'` / `secCli === 'gemini'` conditions into
      a standalone script and asserted all 5 cases (TC-1/2/3/4/5) — all PASS. Confirms: gemini
      selection sets `warned: true`, antigravity/claude selection sets `warned: false`, and the
      claude→antigravity secondary default (`secAgentChoice === '2'`) is unchanged.
- [x] Confirmed via `git diff` that `runAIAgent`/`callLLMConversational`'s existing `cli ===
      'gemini'` dispatch branches (lines 142, 214) are untouched — no runtime behavior removed,
      REQ-5/TC-9 satisfied by construction (only the wizard's menu/prompt code was touched).
- [x] Re-read `SKILL.md`'s updated tables/lines against `bin/lc.mjs`'s actual menu — matches:
      4-option primary/secondary menus, `agy --version` reachability check, `agy` model-input
      fallback, `local-api` example JSON now shows `"agy"` as the example secondary.

## Phase 4: Route actual gemini execution through agy (2026-08-17 reopen)

**Problem**: Phases 1-3 deliberately left `runAIAgent`/`callLLMConversational`
(`bin/lc.mjs`) and `buildCliArgs` (`conductor/laneconductor.sync.mjs`)
untouched — their `cli === 'gemini'` branches still spawn
`npx @google/gemini-cli`. Confirmed live against track 10014
(2026-08-17, dispatch 674): every real dispatch to a gemini-configured
worker fails in ~4s with `Error authenticating: IneligibleTierError: This
client is no longer supported for Gemini Code Assist for individuals.`
`PROVIDERS.gemini.retired = true` and `discoverAvailableModels()` already
treat gemini-cli as dead and fall back to `agy`; execution never got the
same treatment, so a "Gemini" worker can show correct model names (via
track 10011's fix) but can never actually run anything.

**Solution**: the `antigravity`/`agy` branch immediately beside each of
these already builds working `agy` args from the same `model`/`prompt`
inputs — reuse that shape for the `gemini` branch instead of the dead
`npx` invocation, in all three spots. Not deleting the `gemini` case
entirely (keeps `cli: 'gemini'` a valid, recognized value in
`.laneconductor.json`/DB for backward compat — old configs, DB rows, and
providers.mjs's alias handling all still say `'gemini'`) — just changing
what it dispatches to under the hood.

- [x] `conductor/laneconductor.sync.mjs` `buildCliArgs()` (~line 4236):
      `chosenCli === 'gemini'` now builds the same `agy` args as the
      `antigravity`/`agy` branch (`['--dangerously-skip-permissions', '-p', ...]`),
      returns `['agy', args, chosenCli, ...]` — `chosenCli` itself stays
      `'gemini'` in the returned tuple (used elsewhere for
      labeling/model-lookup), only the spawned command/args change.
- [x] `bin/lc.mjs` `callLLMConversational()` (~line 278): same substitution
      — `cmd = 'agy'`, `cmdArgs` built the antigravity way.
- [x] `bin/lc.mjs` `runAIAgent()` (~line 350): same substitution, keeping
      the existing `skillContext` prefix behavior (unlike the
      `buildCliArgs`/`callLLMConversational` sites, this one prepends
      `skillContext` — preserved as-is, only `cmd`/base `cmdArgs` change).
- [x] Live-verified: re-dispatched implement on track 10014 (a real
      gemini-configured worker) after the fix — ran without the
      IneligibleTierError this time.

**Impact**: a `cli: 'gemini'` worker actually executes real work now,
routed through the only Gemini access path that still works on Google's
current tier structure — closing the gap Phases 1-3 explicitly deferred.

## ✅ COMPLETE

## ✅ REVIEWED
