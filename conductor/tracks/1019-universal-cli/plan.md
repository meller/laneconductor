# Plan: Universal CLI (Track 1019)

## Phase 1: Core CLI Scaffolding
- [x] Create `bin/` directory and `bin/lc.mjs` entry point.
- [x] Implement `~/.laneconductorrc` resolution.
- [x] Add `bin` field to `package.json`.
- [x] Add `make install-cli` to root `Makefile`.
- [x] Implement `lc --version`.

## Phase 2: Project Commands
- [x] Implement `lc start`: checks project, starts `conductor/laneconductor.sync.mjs`.
- [x] Implement `lc stop`: kills the heartbeat worker based on `.sync.pid`.
- [x] Implement `lc status`: queries Postgres for current project status.
- [x] Implement `lc ui`: starts the Vite dashboard in `laneconductor/ui`.

## Phase 3: Project Maintenance
- [x] Implement `lc new [name] [desc]`: appends track to `conductor/tracks/intake.md`.
- [x] Implement `lc setup`: runs the setup questionnaire (scaffold + collection).

## Phase 4: Refactor and Polish
- [x] Refactor existing `Makefile` targets to use `lc` where appropriate.
- [x] Update `SKILL.md` to reflect new command availability.
- [x] Test in an external project folder.

## Phase 5: NPM Transition & Publishing ✅
- [x] Add `lc install` command to handle local dependencies.
- [x] Add `lc restart` alias for `stop && start`.
- [x] Refine `getInstallPath()` logic to handle both dev and NPM global installs.
- [x] Update `package.json` with full metadata (`files`, `repository`, `description`, etc.).
- [x] Verify `lc setup` copies canonical templates from global path.
- [x] Add `prepublishOnly` script to run verification.

## Phase 6: Refactor & Cleanup ✅
- [x] Clean up duplicate command definitions in `bin/lc.mjs` (`project`, `verify`, `quality-gate`, `doc`).
- [x] Ensure consistent help output.
- [x] Add `lc logs` support for `local-fs` mode.
- [x] Final end-to-end verification.

## ✅ REVIEWED
Review result: PASS. Universal CLI is fully functional and integrated.

## ✅ QUALITY PASSED
All automated checks passed: syntax, E2E, UI tests, and coverage.

## ✅ COMPLETE
All phases and tasks finished and verified. CLI is ready for distribution.
