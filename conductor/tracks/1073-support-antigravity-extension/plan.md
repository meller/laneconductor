# Plan: Track 1073 — Support Antigravity Extension

## Phase 1: Update CLI Setup & Agent Runner (`bin/lc.mjs`)

**Problem**: 
1. The CLI setup function only symlinks the skill to `.claude/skills/laneconductor`, meaning Google Antigravity agents cannot discover it since they look in `.agents/skills/laneconductor`.
2. The CLI agent runner does not support `agy` (Antigravity CLI) as a provider, only Claude and the old Gemini CLI.
**Solution**: Add symlinking logic for `.agents/skills/laneconductor` and support `agy` execution in the setup wizard and agent runners.

- [ ] Task 1: Edit `bin/lc.mjs` setup block (around line 687) to add `🔗 Symlinking Antigravity workspace skill...`.
  - Check/create `.agents/skills` directory.
  - Create symlink from the global skill directory (e.g. `skillDir`) to `.agents/skills/laneconductor`.
  - Handle cleanup of existing files or symlinks at that path before linking.
- [ ] Task 2: Verify that `.agents/rules/laneconductor.md` symlinking works correctly.
- [ ] Task 3: Update CLI setup agent selection (around line 600) to include `antigravity (agy)` choice.
- [ ] Task 4: Update `callLLMConversational` in `bin/lc.mjs` to support running `agy` with correct arguments (`--dangerously-skip-permissions -p`).
- [ ] Task 5: Update `runAIAgent` in `bin/lc.mjs` to build arguments for `agy` execution.

## Phase 2: Update Sync & Agent Runtimes (`conductor/`)

**Problem**: The worker sync runtime and agent runtime build args and detect rate limits only for Claude and old Gemini CLI, not the new Antigravity CLI.
**Solution**: Update the runtimes to support `agy`/`antigravity` execution and parse its logs for quota exhaustion.

- [ ] Task 1: Update `buildCliArgs` in `conductor/agent-runtime.mjs` to construct arguments for `agy`/`antigravity`.
- [ ] Task 2: Update `checkExhaustion` in `conductor/agent-runtime.mjs` to check for exhaustion on `agy`/`antigravity` calls.
- [ ] Task 3: Update `buildCliArgs` in `conductor/laneconductor.sync.mjs` to support `agy`/`antigravity`.
- [ ] Task 4: Update `checkExhaustion` in `conductor/laneconductor.sync.mjs` to support `agy`/`antigravity`.

## Phase 3: Update AI-Native Setup & Docs

**Problem**: The documentation and executable setup instructions in the skill file are only configuring Claude-based directories.
**Solution**: Update the symlinking shell scripts in `SKILL.md` and project README.

- [ ] Task 1: Update `/laneconductor setup scaffold generate` (around lines 267-278) to include `.agents/skills/laneconductor` symlink code.
- [ ] Task 2: Update `/laneconductor setup scaffold` (around lines 329-340) to also symlink to `.agents/skills/laneconductor`.
- [ ] Task 3: Update `README.md` to add a section about using LaneConductor as a Google Antigravity extension (via custom workspace skills and rules, and using `agy` as CLI).
- [x] Task 4: Add missing commands (`updateTrack`, `reportaBug`, `featureRequest`) to `parameters.options` in `SKILL.md`.

## Phase 3b: Implement missing CLI commands (updateTrack, reportaBug, featureRequest)

**Problem**: The CLI options exist in SKILL.md, but executing `lc update-track`, `lc report-bug`, or `lc feature-request` is not implemented in the CLI binary.
**Solution**: Implement command handling for these three commands in `bin/lc.mjs` supporting both camelCase and kebab-case.

- [x] Task 1: Add command parsing and implementation for `update-track` / `updateTrack` in `bin/lc.mjs`.
- [x] Task 2: Add command parsing and implementation for `report-bug` / `reportaBug` in `bin/lc.mjs`.
- [x] Task 3: Add command parsing and implementation for `feature-request` / `featureRequest` in `bin/lc.mjs`.
- [x] Task 4: Update help printout in `bin/lc.mjs` to document the new commands.

## Phase 4: Verification and Testing

**Problem**: We need to guarantee that the setup creates all three symlinks correctly and runs `agy` commands successfully.
**Solution**: Perform manual setup tests and verify symlinks and agy execution.

- [x] Task 1: Run `lc setup` inside a temporary directory and verify symlinks:
  - `.claude/skills/laneconductor`
  - `.agents/skills/laneconductor`
  - `.agents/rules/laneconductor.md`
- [x] Task 2: Dry-run `lc` with `agy` selected as primary agent to verify execution arguments are built correctly.
- [x] Task 3: Run linter/tests to verify no regressions are introduced.


## Update: Additional Work
- [x] Implement missing update-track, report-bug, feature-request commands in lc.mjs

## ✅ REVIEWED

## ✅ QUALITY PASSED

