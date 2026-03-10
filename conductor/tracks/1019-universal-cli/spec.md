# Spec: Universal CLI (Track 1019)

## Problem Statement
Users need a consistent way to interact with LaneConductor from any project directory without relying solely on `Makefile` targets that must be kept in sync. Currently, `make lc-start` and other commands are the primary way to interact without an LLM, but they require per-project installation and manual updates if the canonical `Makefile` changes.

## Goals
- Provide a global `lc` command available in the terminal.
- Eliminate the need to copy/append `Makefile` targets to every project (though keeping them as an option is fine).
- Centralize command logic in the `laneconductor` repository.
- Support all core worker and UI lifecycle operations.

## Requirements
- **Global Availability**: Installable via `npm link` or `npm install -g`.
- **Project Detection**: Automatically find `.laneconductor.json` or `conductor/` in the CWD or parent directories.
- **Source Resolution**: Use `~/.laneconductorrc` to find the canonical `laneconductor` installation path.
- **Command Parity**: Support at least:
  - `lc start` (worker)
  - `lc stop` (worker)
  - `lc status` (Kanban list)
  - `lc ui` (start/stop UI)
  - `lc new [name] [desc]` (create track)
  - `lc setup` (init project)

## Design
The CLI will be a Node.js script (`bin/lc.mjs`) in the `laneconductor` repository. 
It will use `commander` or a simple `process.argv` parser.
It will read `~/.laneconductorrc` to know where the "home" of LaneConductor is (where `ui/` and `conductor/` scripts live).

## Acceptance Criteria
- [x] \`lc --version\` returns the current version.
- [x] \`lc start\` in a project directory starts the worker.
- [x] \`lc status\` in a project directory shows the tracks.
- [x] \`lc ui\` starts the dashboard.
- [x] CLI is installable via \`make install-cli\`.
- [x] \`lc setup\` initializes new project with templates.
- [x] NPM package metadata (\`package.json\`) is ready for distribution.
- [x] All duplicate command definitions in \`bin/lc.mjs\` are removed.
