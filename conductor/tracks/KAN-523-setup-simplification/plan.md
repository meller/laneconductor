# Plan: Track 1063 (Setup Simplification)

## Phase 1: Metadata & Sync Refactoring
- [x] **Capturing Metadata**: Update `bin/lc.mjs` and `laneconductor.sync.mjs` to track which provider/model/tier actually ran the command.
- [x] **Exit Handler**: Modify the worker exit handler in `laneconductor.sync.mjs` to write `**Last Run**: cli/model (tier)` into the track's `index.md`.
- [x] **Redundant Cleanup**: Replace the old `**Last Run By**` with the new, richer `**Last Run**` marker across the codebase/templates.

## Phase 2: CLI Helper Re-integration
- [x] Extract `runAIAgent` into a reusable helper in `bin/lc.mjs` (Done in Track 1061/Checkpoints).
- [x] Update `lc setup` to call `runAIAgent` immediately after `.laneconductor.json` is written.
- [x] Add an optional transition prompt at the end of `lc setup` that triggers `lc setup-deploy`.

## Phase 3: AI Scaffolding & Environment Verification
- [x] **Skill Update**: Add verification logic to `/laneconductor setup scaffold` in `SKILL.md`.
    - Logic to check for `chokidar`, `git`, and model paths.
- [x] **Verification Output**: Ensure the AI reports verification results clearly in the terminal.
- [x] **Track 001 Creation**: Implement logic in the skill to suggest and/or automatically generate `conductor/tracks/001-fix-environment/` if gaps are found.

## Phase 4: Verification & Testing
- [x] **Unit Tests**: Verify the `**Last Run**` regex matching works for both new and existing tracks.
- [x] **Integration Test**: Run a full `lc setup` simulation in a temp directory.
    - Verify primary succeeds or fallback triggers correctly.
    - Verify `index.md` metadata is correctly stamped.
    - Verify the deployment setup prompt appears.
- [x] **Self-Healing Test**: Manually remove `chokidar` from a test repo and verify the AI creates Track 001.
