# Track 1030: setup scaffold fix

## Phase 1: Enhance `lc setup` (CLI)
**Problem**: Redundant questions and missing config.
**Solution**: Rewrite the `setup` command in `bin/lc.mjs` to include all "hardcoded" configuration fields (operating mode, agents, collectors, etc.) and remove AI-related logic.

- [x] Task 1: Update identity detection (project name, git remote).
- [x] Task 2: Implement operating mode and infrastructure questions (DB host, port, etc.).
- [x] Task 3: Store DB password and collector tokens in `.env`.
- [x] Task 4: Implement agent and model selection (primary/secondary).
- [x] Task 5: Implement project settings (quality gate, dev server).
- [x] Task 6: Cleanup - remove "existing code" question and basic file generation.
- [x] Task 7: Update `.laneconductor.json` and `.gitignore` logic.
- [x] Task 8: Update DB registration logic to include all new fields.

## Phase 2: Refine `/laneconductor setup scaffold` (Skill)
**Problem**: Redundant questions and lack of clarity.
**Solution**: Update `SKILL.md` to focus on AI-powered codebase scanning and context generation.

- [x] Task 1: Remove configuration questions covered by `lc setup`.
- [x] Task 2: Refine the "existing code" scanning flow (Mode A vs Mode B).
- [x] Task 3: Ensure symlink logic is correct.
- [x] Task 4: Clarify that this is the second step of the setup process.

## Phase 3: Validation
- [x] Task 1: Verify `lc setup` creates a complete config.
- [x] Task 2: Verify `/laneconductor setup scaffold` generates correct context files.
- [x] Task 3: End-to-end test on a new project (mock or real).
