# Track 10130: Setup: add LaneConductor to an existing project (route setup to the existing-repo scaffold, drop the stale install text)

## Phase 1: Read an existing repository, scaffold it without a made-up first track
- [x] Tests first: `connector/test/newproject-existing.test.mjs` (fixture repo with package.json, README, CI file, lint config)
- [x] `connector/src/newproject/detect.mjs`: name, summary, stack, real commands, CI, older conductor/tracks (read only)
- [x] `lc-scaffold.mjs --detect` and `--no-first-track`; `writeScaffold({ firstTrack: false })`; no `.gitkeep` added to a tracks folder that has tracks

## Phase 2: Route `setup` to the existing-repo scaffold, drop the stale install text
- [x] `setup/setup.md` rewritten as "add LaneConductor to this project" (follows `ops/new-project.md`); the old text moved to `legacy/setup-daemon.md` (with the daemon-era steps of `scaffold.md`)
- [x] `ops/new-project.md`: "Existing repository" short interview, older tracks described and never imported silently; `scaffold.md` cleaned
- [x] Hook point `Starter set: reserved for the skill advisor (track 10124)` at the end of `setup/setup.md` and `ops/new-project.md`
- [x] Catalog entry `setup` follows new-project's existing-repository path; `scaffold` goes straight to `setup/scaffold.md`; "runs only because you named it" and "tell me before you write" kept
- [x] Generator: base-only rewordings (`DAEMON_FREE_EDITS`) so the base ships no `make install`, rc file, worker, collection or daemon text; regenerate; `--check`; strict validation
- [x] Tests: `commands.test.mjs` (catalog entry), `base-no-daemon-text.test.mjs` (grep), `plugin-build.test.mjs` (updated, not weakened), coverage and plugin-map agree

## Phase 3: scripts/try-local.sh clash fix
- [x] Tests first: dry-run and real-run (fake claude) for the disable step
- [x] Step 4 disables same-named plugins of other marketplaces at local scope inside the scratch repository only, printing each command first
