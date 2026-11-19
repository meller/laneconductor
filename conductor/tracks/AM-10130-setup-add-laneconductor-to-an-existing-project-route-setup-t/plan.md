# Track 10130: Setup: add LaneConductor to an existing project (route setup to the existing-repo scaffold, drop the stale install text)

Design approach: `setup` follows the existing-repository path of `new-project`; the daemon-era text moves to `legacy/`, and the generator keeps it out of the base. Tests first for each phase. Runs after track 10128.

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

## Phase 4: A shorter setup confirmation (owner feedback from a real first run, 2026-11-19)

The confirmation message of setup ran to about 35 lines, and most lines had nothing to act on ("commands I am leaving out", "stale skill: nothing to clean up", "optional plugins: none", "I will not touch README or source"). The one real decision, committed or private tracks, was in the middle. Plan: at most about 12 lines: name and purpose, the stack in one line, the commands that exist, what will be created in one line, the one decision with a recommended default, then "Reply ok, or tell me what differs". An extra line appears only for something unusual or something that needs a decision.

- [ ] Task 4.1: Rewrite the confirmation step in `setup/setup.md` (and the same text in `ops/new-project.md` where it is repeated) to the short form, with the rule "say nothing about what does not exist or does not apply"
- [ ] Task 4.2: Offer the tracks choice with a recommendation (private for a public-looking repository, committed otherwise) as one line, not a paragraph
- [ ] Task 4.3: Facts such as commit counts come from a command run for that purpose, never from a truncated listing
- [ ] Task 4.4: Text tests (the confirmation has the required parts, no list of absent things, ends with the reply line, stays within the line limit) and keep the generated setup command's size from growing

