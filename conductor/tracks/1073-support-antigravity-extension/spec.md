# Spec: Support Antigravity Extension

## Problem Statement
Currently, LaneConductor works as a Claude Desktop skill by symlinking the skill directory to `.claude/skills/laneconductor`. However, Google Antigravity looks for workspace-level custom skills in the `.agents/skills/` directory (specifically, `.agents/skills/laneconductor/SKILL.md`). In order for LaneConductor to be recognized and usable as a custom skill by Google Antigravity, the skill directory must be symlinked to `.agents/skills/laneconductor` during project setup.

Additionally, Google has migrated from the old `gemini-cli` (`@google/gemini-cli`) to the new `antigravity cli` (executable: `agy`). LaneConductor needs to support `antigravity` / `agy` as a CLI execution target in its agent runners and handle quota exhaustion checks appropriately.

## Requirements
- **REQ-1: CLI Setup Skill Symlinking**: Update `bin/lc.mjs` setup function to automatically symlink the LaneConductor skill to `.agents/skills/laneconductor` (in addition to symlinking it to `.claude/skills/laneconductor`).
- **REQ-2: CLI Setup Rule Symlinking**: Ensure `bin/lc.mjs` continues to correctly symlink `laneconductor.md` rules to `.agents/rules/laneconductor.md` (verify correctness).
- **REQ-3: AI-Native Setup (SKILL.md)**: Update the `/laneconductor setup scaffold` and `/laneconductor setup scaffold generate` sections in `SKILL.md` to instruct the AI agent to symlink/copy the skill to `.agents/skills/laneconductor` and rules to `.agents/rules/laneconductor.md` when initializing a new project.
- **REQ-4: Documentation Updates**: Update the project documentation (`README.md`, welcome/wiki HTML files if applicable) to explain how LaneConductor integrates with Google Antigravity as a custom workspace skill and rule.
- **REQ-5: Support Antigravity CLI (agy)**: Support `antigravity` / `agy` as a provider and CLI executable across `bin/lc.mjs`, `agent-runtime.mjs`, and `laneconductor.sync.mjs`. Handle prompt execution (`agy --dangerously-skip-permissions -p "<prompt>"`) and rate limit/exhaustion detection for `agy` execution logs.
- **REQ-6: Missing Skill Commands**: Add missing commands (`updateTrack`, `reportaBug`, `featureRequest`) to the `parameters.options` section in `SKILL.md` to ensure they are available in the Gemini extension workspace skill.
- **REQ-7: Implement `updateTrack` CLI Command**: Implement `/laneconductor updateTrack` (and `lc update-track`) to find the track folder, append the description of new work to `plan.md`, and move the track to `backlog` in both the filesystem (`index.md`) and local database.
- **REQ-8: Implement `reportaBug` CLI Command**: Implement `/laneconductor reportaBug` (and `lc report-bug`) to create a new track with type `bug`, generate a `NNN-bug-slug` folder with bug templates, and append it to the sync queue and database.
- **REQ-9: Implement `featureRequest` CLI Command**: Implement `/laneconductor featureRequest` (and `lc feature-request`) to create a new track with type `feature` (using feature templates) and queue it.

## Acceptance Criteria
- [x] `bin/lc.mjs` contains logic to create `.agents/skills/laneconductor` symlink targeting the global installation skill path.
- [x] Running `lc setup` in a fresh directory initializes both `.claude/skills/laneconductor` and `.agents/skills/laneconductor` symlinks, as well as the rules symlink.
- [x] `SKILL.md` contains the updated bash setup commands for symlinking both `.claude` and `.agents` workspace configurations.
- [x] `bin/lc.mjs`, `agent-runtime.mjs`, and `laneconductor.sync.mjs` support running commands via `agy` with correct arguments (`--dangerously-skip-permissions -p`).
- [x] Rate limits and exhaustion on `agy` are parsed and reported as provider-exhaustion states (mapped to `agy`/`antigravity` in cache and server).
- [x] Documentation updated to reference Google Antigravity integration and capabilities.
- [x] `SKILL.md` frontmatter includes `updateTrack`, `reportaBug`, and `featureRequest` in the allowed command options.
- [x] `lc update-track` / `updateTrack` CLI command implemented and tested.
- [x] `lc report-bug` / `reportaBug` CLI command implemented and tested.
- [x] `lc feature-request` / `featureRequest` CLI command implemented and tested.



