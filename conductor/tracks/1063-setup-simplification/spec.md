# Spec: Setup Simplification

## Problem Statement
The current setup process for LaneConductor is fragmented. A user must run `lc setup` in their terminal, answer several questions, and then manually switch to an AI agent (like Claude Code or Gemini CLI) to run `/laneconductor setup scaffold`. This multi-step process is friction-heavy for new users.

## Requirements
- `lc setup` should automatically transition into the AI-driven scaffolding phase.
- The transition should use the primary AI agent configured during the manual setup.
- If the AI agent fails or is not available, the user should be informed and given instructions on how to run it manually.
- The flow should feel like a single continuous setup experience.

## Acceptance Criteria
- [ ] Running `lc setup` completes the manual configuration.
- [ ] Immediately after manual configuration, the AI agent is spawned to run `setup scaffold`.
- [ ] The AI agent correctly scans the codebase and generates `product.md`, `tech-stack.md`, etc.
- [ ] The final output of `lc setup` includes the results of the AI scaffolding.
