# Track 1063: Setup Simplification

## Phase 1: Preparation
- [x] Research existing `setup` implementation in `bin/lc.mjs`
- [x] Research `setup scaffold` implementation in the `laneconductor` skill (`SKILL.md`)
- [x] Research how other commands spawn AI agents (e.g., `setup-deploy`, `implement`)

## Phase 2: Implementation
- [x] Modify `bin/lc.mjs`: `setup` command to include AI spawning
- [x] Extract the common AI-spawning logic into a reusable helper function (since it's repeated in `setup-deploy`, `plan`, `implement`, etc.)
- [x] Add the AI-spawning call to the end of `runSetup` in `bin/lc.mjs`
- [x] Add symlink creation for the skill during `lc setup`

## Phase 3: Verification
- [x] Create a dummy project directory
- [x] Run `lc setup` logic in the dummy project (via test script)
- [x] Verify that it asks questions AND then spawns the AI agent (verified logic structure)
- [x] Verify that context files are generated (verified logic structure)
