# Spec: Per-project Install Flow

## Problem Statement
Users need a reliable, one-command way to add LaneConductor to any existing or new project, ensuring all necessary folder structures, configurations, and skill symlinks are correctly established.

## Requirements
- REQ-1: Provide a root-level `make install` command that marks the installation path globally.
- REQ-2: Implement a `setup scaffold` command that creates the `conductor/` directory and populates it with standard context files.
- REQ-3: Automatically symlink the LaneConductor skill into the project's `.claude/skills/` directory.
- REQ-4: Implement a `setup collection` command to configure database connections and agent settings.
- REQ-5: Ensure the heartbeat worker (`laneconductor.sync.mjs`) is correctly deployed and configured with valid PostgreSQL syntax.

## Acceptance Criteria
- [x] `make install` writes the current skill directory to `~/.laneconductorrc`.
- [x] `setup scaffold` creates `product.md`, `tech-stack.md`, `workflow.md`, `product-guidelines.md`, and `tracks.md`.
- [x] `setup scaffold` appends `lc-*` targets to the project's `Makefile`.
- [x] `setup scaffold` creates a functional symlink to the global skill directory.
- [x] `setup collection` successfully registers the project in the `projects` table and writes `project.id` to `.laneconductor.json`.
- [x] `laneconductor.sync.mjs` uses `$1`, `$2` placeholders for PostgreSQL queries to avoid argument substitution bugs.
