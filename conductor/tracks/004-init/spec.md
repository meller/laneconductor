# Spec: Init Setup Verification

## Problem Statement
The `/laneconductor setup` command (scaffold + collection) is the entry point for all new projects. It must work reliably, ask the right questions, and leave the project in a fully working state.

## Requirements
- REQ-1: `setup scaffold` creates all required `conductor/` files with meaningful content
- REQ-2: `setup scaffold` symlinks the skill correctly into `.claude/skills/laneconductor`
- REQ-3: `setup scaffold` adds all `lc-*` Makefile targets
- REQ-4: `setup collection` asks for DB config, primary CLI+model, secondary CLI+model
- REQ-5: `setup collection` verifies CLI reachability before proceeding
- REQ-6: `setup collection` discovers models dynamically (not hardcoded)
- REQ-7: `setup collection` writes `.laneconductor.json` with correct structure
- REQ-8: `setup collection` creates DB schema and registers project with correct `id`
- REQ-9: `make lc-start` starts the heartbeat worker without errors
- REQ-10: Heartbeat syncs track file changes to DB within 500ms

## Acceptance Criteria
- [ ] Running `/laneconductor setup` on a blank project directory completes without errors
- [ ] All `conductor/` files exist and have non-stub content
- [ ] `.laneconductor.json` exists with `project.id` populated (not null)
- [ ] `make lc-start` runs without errors
- [ ] Creating a track file in `conductor/tracks/` triggers a DB sync
- [ ] `/laneconductor status` shows the project in the correct lane

## Out of Scope
- Non-Node projects (no `package.json`) — tracked in backlog 004
- Windows path handling
