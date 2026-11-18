# Tests: Track 10130 - Setup: add LaneConductor to an existing project (route setup to the existing-repo scaffold, drop the stale install text)

## Test Commands
- `cd connector && npm test` (all connector tests; includes the files below)
- `node scripts/build-plugin.mjs --check`
- `claude plugin validate --strict plugins/laneconductor` (also `plugins/laneconductor-parallel`, `plugins/laneconductor-board` and `.`)

## Test Cases
- [x] TC-1 (regression): a test that reproduces the bug (the steps in "Steps to reproduce") and FAILS before the fix; it passes after the fix and stays in the suite. Covered by `connector/test/base-no-daemon-text.test.mjs` (the old `setup/setup.md` carried `make install`, `~/.laneconductorrc`, a worker; the generated `setup` command pointed at it) and `connector/test/commands.test.mjs` (setup follows new-project)
- [x] TC-2: a fixture existing repository (package.json with a test script, README, CI file) gets the conductor files with the detected stack and the real test command in `quality-gate.md` (`newproject-existing.test.mjs`)
- [x] TC-3: a second run changes nothing; an existing README, package.json, CI file and lint config are never touched (`newproject-existing.test.mjs`, also through the CLI)
- [x] TC-4: files the project already has under conductor/ are kept; older tracks (prefixed, bare, foreign) are described, never imported or changed (`newproject-existing.test.mjs`)
- [x] TC-5: a command is proposed only if the project has it (npm placeholder test script, lint config without a lint script) (`newproject-existing.test.mjs`)
- [x] TC-6: grep proof: no file of the base plugin, and nothing the generator builds for it, mentions `make install`, `laneconductor` rc file, a worker, collection or the daemon (`base-no-daemon-text.test.mjs`)
- [x] TC-7: the `setup` catalog entry points at `ops/new-project.md` (existing-repo path) and `scaffold` at `setup/scaffold.md`; keeps "runs only because I named it" and "tell me what you are about to create or change" (`commands.test.mjs`, `base-no-daemon-text.test.mjs`)
- [x] TC-8: the coverage test and `docs/plugin-map.md` still agree (`plugin-coverage.test.mjs`, `plugin-map.test.mjs`, `node scripts/build-plugin.mjs --check`)
- [x] TC-9: the base still passes the directory-portal emulation (`directory-base.test.mjs`)
- [x] TC-10: `scripts/try-local.sh` dry run prints the local-scope disable of the owner's real same-named plugins after the installs and runs nothing; a real run (fake claude) runs only `plugin disable <id> --scope local` inside the scratch repository, nothing at user scope; nothing to disable and an unreadable list are handled (`try-local.test.mjs`)

## Acceptance Criteria
- [x] All connector tests pass
- [x] `--check` and strict validation of the three plugins and the marketplace pass
- [ ] Human: try `scripts/try-local.sh` for real once and run `/laneconductor:setup` in a copy of an existing project (not run by the implementer)
