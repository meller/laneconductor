# Track 1013: Multi-CLI Agent Support (Gemini, Codex, Amp)

## Phase 1: Codex CLI — Invocation + Exhaustion Detection

**Problem**: `buildCliArgs()` has no explicit Codex branch; Codex errors are not detected.
**Solution**: Add `codex` case to `buildCliArgs` and `detectExhaustion`.

- [ ] Task 1: Research actual Codex CLI invocation format
    - [ ] Run `codex --help` (if installed) or check OpenAI CLI docs
    - [ ] Confirm auto-approval flag name and prompt argument format
    - [ ] Confirm model flag syntax
- [ ] Task 2: Add `codex` branch in `buildCliArgs()` in `laneconductor.sync.mjs`
    - [ ] Format: `codex --approval-mode full-auto -p "{contextMsg}{prompt}" [--model {model}]`
    - [ ] Inject skill context via prompt prefix (same pattern as gemini)
    - [ ] Return `['codex', args, 'codex']`
- [ ] Task 3: Add Codex exhaustion detection in `detectExhaustion()`
    - [ ] Pattern: `"rate_limit_exceeded"` or `"exceeded your current quota"` in output
    - [ ] Pattern: HTTP 429 string in output
    - [ ] POST to `/provider-status` with `provider: 'codex'`
    - [ ] Default cooldown: 60s (no explicit reset time in Codex errors)
- [ ] Task 4: Add `isProviderAvailable` support for `codex`
    - [ ] Reachability check: `codex --version` exits 0

**Impact**: `primary_cli = "codex"` becomes a functional option.

---

## Phase 2: Amp CLI — Invocation + Exhaustion Detection

**Problem**: Same gap as Codex — no explicit Amp branch in `buildCliArgs`.
**Solution**: Add `amp` case and exhaustion detection.

- [ ] Task 1: Research actual Amp CLI invocation format
    - [ ] Run `amp --help` (if installed) or check Sourcegraph Amp docs
    - [ ] Confirm auto-approval / non-interactive flag (`--yes`?)
    - [ ] Confirm model flag and prompt argument format
- [ ] Task 2: Add `amp` branch in `buildCliArgs()` in `laneconductor.sync.mjs`
    - [ ] Format: `amp run --yes -p "{contextMsg}{prompt}" [--model {model}]`
    - [ ] Inject skill context via prompt prefix
    - [ ] Return `['amp', args, 'amp']`
- [ ] Task 3: Add Amp exhaustion detection in `detectExhaustion()`
    - [ ] Pattern: `"rate limit"` (case-insensitive) in output
    - [ ] Pattern: `"quota exceeded"` (case-insensitive) in output
    - [ ] POST to `/provider-status` with `provider: 'amp'`
- [ ] Task 4: Add `isProviderAvailable` support for `amp`
    - [ ] Reachability check: `amp --version` exits 0

**Impact**: `primary_cli = "amp"` becomes a functional option.

---

## Phase 3: Dynamic Skill Path Resolution

**Problem**: `skillPath` is hardcoded to `/home/meller/Code/laneconductor/...`. Breaks on any other machine.
**Solution**: Read from `~/.laneconductorrc` (already written by `make install`).

- [ ] Task 1: Add `resolveSkillPath(skill)` helper function in `laneconductor.sync.mjs`
    - [ ] Read `~/.laneconductorrc` → get install path
    - [ ] Fallback: `~/Code/laneconductor/.claude/skills/` if RC not found
    - [ ] Return `join(skillsBase, skill, 'SKILL.md')`
- [ ] Task 2: Replace hardcoded `skillPath` in `buildCliArgs()` with `resolveSkillPath(skill)`
- [ ] Task 3: Verify the resolved path exists before using it
    - [ ] If missing: log warning, omit context prefix (don't crash)
- [ ] Task 4: Add context injection pattern for `codex` and `amp` (different from claude)
    - [ ] Claude: no context prefix (loads skill natively from `.claude/skills/`)
    - [ ] Gemini, Codex, Amp: `"Use the /{skill} skill. Skill definition is at: {skillPath}. "`

**Impact**: Sync worker works correctly on any machine, not just the author's.

---

## Phase 4: Setup Collection — Model Discovery for Codex + Amp

**Problem**: `setup collection` can discover Gemini models dynamically but not Codex or Amp.
**Solution**: Add discovery commands for Codex and Amp in the SKILL.md setup flow.

- [ ] Task 1: Update SKILL.md `setup collection` — Codex model discovery
    - [ ] Discovery command: `codex models` (or `codex --list-models`)
    - [ ] If exits 0: parse newline-separated model IDs and present as choices
    - [ ] If fails/times out (>15s): fall back to free-text entry
- [ ] Task 2: Update SKILL.md `setup collection` — Amp model discovery
    - [ ] Discovery command: `amp models list` (or `amp --list-models`)
    - [ ] Parse model names from output
    - [ ] Fall back to free-text entry on failure
- [ ] Task 3: Update SKILL.md reachability check table to include Codex and Amp
    - [ ] `codex --version` → exits 0
    - [ ] `amp --version` → exits 0
- [ ] Task 4: Update `.laneconductor.json` schema documentation to list valid `cli` values
    - [ ] Valid: `claude`, `gemini`, `codex`, `amp`, `other`

**Impact**: `setup collection` can fully configure Codex and Amp projects end-to-end.

---

## Phase 5: Documentation + Workflow Examples

**Problem**: No documentation on how to use non-Claude agents in workflow.md.
**Solution**: Add clear examples and update product docs.

- [ ] Task 1: Update `conductor/workflow.md` with multi-cli lane override examples
    - [ ] Example: use `codex` for `in-progress`, `haiku` for `planning`
    - [ ] Example: use `amp` as secondary with Claude as primary
- [ ] Task 2: Add multi-CLI section to `conductor/product.md`
    - [ ] List supported CLIs and their use cases
    - [ ] Note: Filesystem-as-API means agents are interchangeable
- [ ] Task 3: Update SKILL.md quick reference table with supported CLI values
- [ ] Task 4: Commit with `feat(track-1013): multi-CLI agent support`
