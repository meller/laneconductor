# Spec: Setup: add LaneConductor to an existing project (route setup to the existing-repo scaffold, drop the stale install text)

## Problem Statement

Found 2026-11-18 while answering the owner's question 'does setup support creating the LaneConductor structure for an existing project': `/laneconductor:new-project` already handles it (detects an existing repository, offers only the `conductor/` scaffold, reads package.json, README, source folders and CI or lint config to fill the stack and the quality-gate commands, never overwrites, skips existing files, merges .gitignore, adds no duplicate tracks on a re-run).

BUT `/laneconductor:setup` still points at `.claude/skills/laneconductor/setup/setup.md`, whose text comes from the retired, experimental, currently unmaintained daemon era: `make install`, `~/.laneconductorrc`, symlinking the skill into the project, collection and worker setup. That is wrong for the plugin and sends a person typing `setup` in an existing project down the wrong path.

- Symptom: `setup` in an existing project leads to daemon-era install steps instead of adding the `conductor/` scaffold.
- Expected: `setup` means "add LaneConductor to this project" and follows the existing-repository path of `new-project`.
- Actual (before the fix): the generated `setup` command pointed at the daemon-era `setup/setup.md`.
- Suspected area: the skill source `setup/setup.md`, the catalog entry `setup`, and the generator that builds the base plugin. The track runs after track 10128 is merged, because 10128 rewrites the same generated files.

## Requirements

- REQ-1 `setup` means "add LaneConductor to this project": the command's procedure follows `ops/new-project.md` (its existing-repository path). `scaffold` is the explicit action that goes straight to `setup/scaffold.md` and `setup/templates.md`. The "runs only because you named it" rule and "tell me what you are about to create or change before you write anything" stay.
- REQ-2 The daemon-era content (install with make, the rc file, collection and worker setup, symlinking the skill into the project) is removed from `setup/setup.md` in the skill source and kept only under `legacy/`, which the plugin builds do not ship. The base plugin does not mention `make install`, `~/.laneconductorrc` or a worker.
- REQ-3 For an existing project the interview is short: the project name, stack, test and lint commands are inferred from the files and the person only confirms them. A command is proposed only if the project has it. If the repository already has `conductor/tracks` from an older LaneConductor, the command says what was found and imports nothing silently.
- REQ-4 After the scaffold, the starter-set offer of recommended skills belongs here too (track 10124): a clearly marked hook point is left, the offer is not built here.
- REQ-5 Reading an existing repository is read only (`connector/src/newproject/detect.mjs`: name, summary, stack, real commands, CI, older conductor/tracks); the scaffold script takes `--detect` and `--no-first-track` and writes no made-up first track and no `.gitkeep` in a tracks folder that already has tracks. An existing README, package.json, CI file or lint config is never touched; a second run changes nothing.
- REQ-6 The generator ships the base without daemon-era text (base-only rewordings, `DAEMON_FREE_EDITS`); the plugins are regenerated, `--check` and strict validation pass.
- REQ-7 `scripts/try-local.sh` step 4 disables, at local scope and inside the scratch repository only, any enabled plugin of the same names that comes from another marketplace, printing each command first; nothing is written at user scope.

## Decisions

- Do this after track 10128 is merged (depends on 10128), because it rewrites the same generated files.
- The daemon-era setup text is moved to `legacy/setup-daemon.md` (with the daemon-era steps of `scaffold.md`), not deleted; the plugin builds do not ship `legacy/`.
- The starter-set offer (track 10124) is a hook point only: `Starter set: reserved for the skill advisor (track 10124)` at the end of `setup/setup.md` and `ops/new-project.md`.
- Older tracks found in an existing repository (prefixed, bare, foreign) are described and never imported or changed silently.

## Acceptance criteria

- [x] A fixture existing repository (package.json with a test script, README, CI file) gets the conductor files with the detected stack and the real test command in `quality-gate.md` (REQ-3, REQ-5; `connector/test/newproject-existing.test.mjs`, `connector/src/newproject/detect.mjs` exist).
- [x] A second run changes nothing; an existing README, package.json, CI file and lint config are never touched (REQ-5; `newproject-existing.test.mjs`).
- [x] A grep test proves no file of the base plugin mentions `make install`, `~/.laneconductorrc` or a worker (REQ-2, REQ-6; `connector/test/base-no-daemon-text.test.mjs` exists, and it passed in a run of the suite in this checkout).
- [x] The `setup` catalog entry points at `ops/new-project.md` (existing-repository path) and `scaffold` at `setup/scaffold.md` (REQ-1; `connector/test/commands.test.mjs`).
- [x] `legacy/setup-daemon.md` exists in the skill source (REQ-2).
- [x] The `try-local.sh` disable step has tests for dry run and real run with a fake `claude` (REQ-7; `connector/test/try-local.test.mjs`).
- [ ] All connector tests, `node scripts/build-plugin.mjs --check` and strict validation of the three plugins and the marketplace pass. Not verified here: 25 of the 57 test files could not load in this checkout (the MCP SDK packages are not installed); the ones that ran passed.
- [ ] Human acceptance: run `scripts/try-local.sh` for real once and run `/laneconductor:setup` in a copy of an existing project (owner; not run by the implementer).

## Risks and limits

- Until the human acceptance run, the shipped text is only proven by tests and a grep, not by a person typing `setup` in a real project.
- Starter-set hook only: nothing recommends skills yet from this command.
- `try-local.sh` disables other marketplaces' same-named plugins at local scope in the scratch repository only; a plugin enabled elsewhere is untouched.

## Out of scope

- The starter-set offer itself (track 10124).
- Importing older `conductor/tracks` into the new layout.
- Any change to the daemon (experimental, currently unmaintained).
