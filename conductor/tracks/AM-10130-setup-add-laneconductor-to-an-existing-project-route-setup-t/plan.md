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

- [x] Task 4.1: Rewrite the confirmation step in `setup/setup.md` (and the same text in `ops/new-project.md` where it is repeated) to the short form, with the rule "say nothing about what does not exist or does not apply"
- [x] Task 4.2: Offer the tracks choice with a recommendation (private for a public-looking repository, committed otherwise) as one line, not a paragraph
- [x] Task 4.3: Facts such as commit counts come from a command run for that purpose, never from a truncated listing
- [x] Task 4.4: Text tests (the confirmation has the required parts, no list of absent things, ends with the reply line, stays within the line limit) and keep the generated setup command's size from growing

## Phase 5: Setup ends with the next step, not with "run next" (owner feedback, 2026-11-19)

Setup's last step tells the person to run `/laneconductor:next` and not to name the step. Setup already knows it: the first track. It should show that step itself (the same short S04 card as `next`, track 10144 Phase 10) instead.

- [x] Task 5.1: Setup's closing message ends with the S04 first-track card (suggested tracks, the board line, own title) and no "run next" line; written once and shared with `next` so the two cannot differ
- [x] Task 5.2: Keep the committed-or-not question about the context files short and last-but-one; do not ask two questions at the end (the first-track choice and the commit question): ask the commit question only after the track choice, or fold it into the closing line
- [x] Task 5.3: Text tests (setup's closing has the card and no "Next: run" line) and keep the generated setup command's size from growing

## Phase 6: Setup analyses an existing project (owner feedback, 2026-11-19)

Setup reads the README and `package.json`. For an existing project it should also read the project's own plan, so the owner sees the value at once: it looks for `docs/plan.md`, `ROADMAP.md`, `TODO.md` and roadmap, next-steps or status sections of the README, and says in the confirmation what it found ("Found your plan in docs/plan.md: 6 items"). The closing card then leads with those items (track 10144 Phase 11).

- [x] Task 6.1: Setup's reading step looks for the project's plan documents and counts their items; the confirmation names the file and the count in one line, and says nothing when there is none
- [x] Task 6.2: The plan items are carried into the closing card (written once, shared with `next`); the project definition files (product.md, user-stories.md) may use them as source for facts, never inventing any
- [x] Task 6.3: An empty folder or a project with no code goes to `/laneconductor:new-project` (a brainstorm interview, then the scaffold, first tracks and suggested skills), not to the existing-project path
- [x] Task 6.4: Text tests and a size check (setup must not grow)

## Phase 7: Setup writes first, and `go` is the consent (owner direction, 2026-11-19; release 1.9.5)

The pre-write confirmation ("Reply ok, or tell me what differs") is one more turn before any value. New files are additive and reversible, so setup writes first and shows what it created with a one-line undo. It stops to ask only when something is unusual: an existing `conductor/` folder with content, no git repository, or uncommitted changes in a file it would touch. The `go` reply to the `next` card (track 10144 Phase 12) and a direct `/laneconductor:setup` both mean yes. This supersedes the "one pre-filled message ending Reply ok" rule of track 10132 TC-2 for the first-run path.

- [x] Task 7.1: Rewrite setup's flow to: analyse, write, then one summary (what it created, the declared privacy line, the undo line, the plan items found), then file the first four plan items as tracks when invoked through `go` (or when the person picked them), then the two-item closing offer of Phase 12
- [x] Task 7.2: The unusual cases still ask first, in one line each (existing `conductor/` with content, no git repository, uncommitted changes in a file setup would touch)
- [x] Task 7.3: Update 10132 TC-2 and its text test to match, keep the generated setup command from growing, and run the headless end-to-end check

