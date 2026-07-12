# Spec: Migrate Gemini CLI support to Antigravity

## Problem Statement

Google retired the standalone Gemini CLI in favor of Antigravity. LaneConductor's actual
CLI-invocation code already treats `antigravity`/`agy` as a first-class agent alongside
`claude` and `gemini`:

- `bin/lc.mjs`'s `runAIAgent()` and `callLLMConversational()` both already spawn `agy
  --dangerously-skip-permissions -p ...` for `cli === 'antigravity' || cli === 'agy'`.
- `bin/lc.mjs`'s `lc setup` wizard already offers `[2] antigravity (agy)` in the primary/
  secondary agent menu, and already defaults the secondary agent to antigravity when the
  primary is claude.
- `conductor/laneconductor.sync.mjs`'s `buildCliArgs()` and exhaustion-detection regex
  already branch on `agy`/`antigravity` alongside `gemini`.

So the underlying "drive Antigravity as an agent CLI" work is done (likely landed
incrementally alongside track 1013). What's **not** done is anything that reflects Gemini
CLI's retirement:

- The agent-selection menu presents `gemini` as a plain, undeprecated, equally-weighted
  choice — no signal to the user that it's a retired product.
  choosing it silently proceeds with no warning.
- `.claude/skills/laneconductor/SKILL.md`'s `/laneconductor setup collection` documentation
  (the reachability-check table and model-discovery table under step 4) documents `claude`
  and `gemini` only — no `agy`/antigravity row at all, even though the real wizard in
  `bin/lc.mjs` already offers it. The skill doc has drifted from the actual implementation.

## Requirements

- REQ-1: `bin/lc.mjs`'s primary and secondary agent menus label `gemini` as retired (e.g.
  `[3] gemini (retired — use antigravity)`).
- REQ-2: Choosing `gemini` (primary or secondary) prints a one-line, non-blocking warning
  noting the retirement and pointing at antigravity, plus the `lc config` command to switch
  later (e.g. `lc config project.primary.cli agy`). Setup still proceeds — no forced block.
- REQ-3: Existing default-suggestion behavior (recommended primary = claude, default
  secondary = antigravity when primary is claude) is preserved, not weakened.
- REQ-4: `SKILL.md`'s `/laneconductor setup collection` step 4 — both the reachability-check
  table and the model-discovery table — gain an `agy`/antigravity row, and the `gemini` row
  is annotated as retired, so the doc matches what `bin/lc.mjs` actually offers.
- REQ-5: No breaking change for existing `.laneconductor.json` files with
  `project.primary.cli: "gemini"` (or secondary) — they must keep working exactly as before;
  this track only affects the *setup-time* UX and docs, not runtime CLI dispatch (which
  already fully supports gemini and isn't being removed).

## Acceptance Criteria

- [ ] Running `lc setup` and selecting `gemini` as primary or secondary shows a retirement
      warning but does not abort.
- [ ] Running `lc setup` and selecting `antigravity (agy)` shows no warning and proceeds
      normally (already-working path, must not regress).
- [ ] `SKILL.md`'s reachability-check and model-discovery tables both list an `agy` row.
- [ ] A project with an existing `.laneconductor.json` using `"cli": "gemini"` still runs
      `lc start` / any AI-agent-driven command without error (no forced migration).

## Data Model Changes

None — this is setup-wizard UX + documentation only, no schema or `.laneconductor.json`
shape changes.
