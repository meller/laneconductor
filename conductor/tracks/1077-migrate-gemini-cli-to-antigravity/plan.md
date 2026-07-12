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

## ✅ COMPLETE
