# Spec: Setup Simplification

## Problem Statement
The current setup process for LaneConductor is fragmented. A user must run `lc setup` in their terminal, answer several questions, and then manually switch to an AI agent (like Claude Code or Gemini CLI) to run `/laneconductor setup scaffold`. This multi-step process is friction-heavy for new users.

## Requirements
- `lc setup` should automatically transition into the AI-driven scaffolding phase.
- The transition should use the primary AI agent configured during the manual setup.
- If the AI agent fails or is not available, the user should be informed and given instructions on how to run it manually.
- The flow should feel like a single continuous setup experience.
- **Metadata Visibility**: Update `index.md` `**Last Run**` marker to include `cli/model (tier)` (e.g., `claude/haiku (primary)` or `gemini (secondary)`) so fallbacks are visible.
- **Environment Verification**: The AI scaffolding phase must verify the environment:
    - `chokidar` installation.
    - `git` initialization.
    - AI providers in the system `PATH`.
- **Self-Healing**: If critical dependencies are missing, the AI should offer to create **Track 001: Environment Fixes** automatically.
- **Optional Deployment Setup**: After the initial AI scaffolding, the system should ask if the user wants to continue to configure the deployment stack (`lc setup-deploy`).

## Acceptance Criteria
- [ ] Running `lc setup` completes the manual configuration and spawns the AI agent.
- [ ] AI agent scans the codebase and generates context files.
- [ ] Track `index.md` files show rich `**Last Run**` metadata correctly.
- [ ] Environment verification runs during `setup scaffold`.
- [ ] AI correctly identifies missing dependencies and offers a fix track.
- [ ] The user is prompted to optionally continue to deployment configuration.
- [ ] The final output summarizes both configuration and environment status.
