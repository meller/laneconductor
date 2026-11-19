# Track 10144: What's next: a state-aware command that names the next step and explains it (onboarding as a tutorial)

Order: build after track 10143 merges (both edit `connector/src/commands.mjs`; this track does not touch the `new`, `bug` and `feature` procedures or `create_track`). The spec's state table (S01 to S21), ranking (REQ-19) and decisions (D1 to D12) are the contract. Test commands are in `test.md`.

## Phase 1: The procedure text and the skill edits

**Problem**: Nothing in the skill says what to do when the person is unsure; the state table and ranking must exist as one reference the command points to.
**Solution**: One new skill file, `ops/next.md`, with the state table (same ids as the spec), the gathering steps (base and connector), the ranking rule, the card format, the levels and the front door. The card text never names a track number or a future version.

- [x] Task 1.1: Write `.claude/skills/laneconductor/ops/next.md`: sections "When to use it" (any time the person is unsure; read only), "Gather" (REQ-6 to REQ-11 in order, base first, then what the connector adds), "States" (the S01 to S21 table with an id column, one row each, command column), "Rank" (REQ-19 as a numbered list), "The card" (REQ-5, with the short and explain forms as two worked examples), "Levels" (REQ-21 to REQ-23), "The front door" (REQ-14 to REQ-16, with the marker line `<!-- generated: recommended plugins -->`), "Rules" (read only; ask before anything is written; never push; never run an install).
    - [x] Sub-task: the primer for the explain level: five lanes, five statuses, `done:queue` versus `done:success`, what a marker is, why this order; at most twelve lines.
    - [x] Sub-task: a short section for the stale question and for the S21 damaged-track line, with the exact wording.
- [x] Task 1.2: `SKILL.md` (source): add the routing-table row for `next` ("May start unprompted: yes, read only"), a line under the table saying that "I am not sure what to do" and "what now" mean `next`, and the `Priority` row in the markers table (`high | normal | low`, optional, read by `next`).
- [x] Task 1.3: `ops/settings.md`: one key row `next.level` (`auto`, `explain`, `short`; default `auto`; read by the `next` command only) and one rule line (a missing file or unknown value means `auto`).
- [x] Task 1.4: `ops/new-project.md` and `setup/setup.md` end-of-run lines: replace the free-form next-step line with "Next: run `/laneconductor:next`" (REQ-26), keeping the generated-recommendation marker and the "once per session" rule intact.

**Impact**: A reader of the skill can follow `next` by hand; no code yet.

## Phase 2: The catalog entry, the generated texts and the build

**Problem**: The command must appear in the base, the parallel add-on's prompts and `help`, generated from the one catalog.
**Solution**: Add the entry to `connector/src/commands.mjs`, the base procedure and extras to `scripts/plugin-texts.mjs`, the recommendation block to `ops/next.md`, then rebuild.

- [x] Task 2.1: `connector/src/commands.mjs`: add group `start here` first in `GROUPS`, move `help` into it, add the entry `next` (title "What's next", description "Name the one next step for this project and explain it (read only)", example "what's next", arg `option` optional with hint `explain | short | track number`), procedure a short pointer to `ops/next.md` (read it in full first; read only; one step; the card). Add an entry flag `readOnly: true`.
- [x] Task 2.2: `scripts/plugin-texts.mjs`: `BASE_PROCEDURES.next` (files only: Glob, Grep, read-only git, the card; the same pointer), `BASE_EXTRAS.next` (the slash form `/laneconductor:next`), `connectorLine` for a `readOnly` command ("use the tools to read; they report freshness; this command writes nothing"), and `skillEdits()` gets `'ops/next.md': [recommend]` so the recommendation block is injected at the marker.
- [x] Task 2.3: `connector/plugin-extras/coverage.json`: nothing if the routing row exists (Task 1.2); otherwise a `catalogOnly` reason. Run the coverage test to see which.
- [x] Task 2.4: Rebuild with `node scripts/build-plugin.mjs`; commit the regenerated `plugins/*` files, `docs/plugin-map.md` and the README command lists (`README.md`, `connector/README.md`) by name. `node scripts/build-plugin.mjs --check` exits 0.

**Impact**: `next` is a command in the base, a prompt in the parallel add-on and a line in `help`.

## Phase 3: Closing hints everywhere a person can get stuck

**Problem**: The universal fallback is only universal if every dead end points to it.
**Solution**: Small edits in one place each; no footer on every command.

- [x] Task 3.1: `helpLines` intro in `connector/src/commands.mjs`: add the "Not sure where to go? Use `next`" line (REQ-25); `BASE_HELP_FOOTER` unchanged.
- [x] Task 3.2: `BASE_HABITS` in `scripts/plugin-texts.mjs`: the two edits of REQ-27.
- [x] Task 3.3: `connector/src/instructions.mjs`: the one sentence of REQ-29; the KC-8 length test stays green.
- [x] Task 3.4: Check `status` ends its procedure with a pointer to `next` for the choice; the `status` text change is one sentence in the base and catalog procedure.

**Impact**: Help, setup, a finished lane and the session start all point to the same command.

## Phase 4: Levels and the personal setting

**Problem**: The tutorial must teach early and get out of the way without writing files nobody asked for.
**Solution**: Stateless `auto`, explicit `next explain` and `next short`, and an opt-in stored level.

- [x] Task 4.1: In `ops/next.md`, write the `auto` rule (REQ-22) with the exact counting rule (tracks whose lane is review, quality-gate or done, fewer than three means young) and the "ask first, then add the ignore line" write path (REQ-23), copying the wording of the board procedure for the ignore line.
- [x] Task 4.2: Settings read: a missing, invalid or unknown-valued file means `auto` with no message beyond one line when the JSON is invalid (as `ops/settings.md` says).

**Impact**: First-time users get the primer; others get one line; the setting exists only if wanted.

## Phase 5: The journey text for the website and README

**Problem**: The owner wants the same "install, run next, progress" story on the site.
**Solution**: One generated block.

- [x] Task 5.1: `NEXT_JOURNEY` in `scripts/plugin-texts.mjs` (REQ-31), built from the catalog (the add-on names and install blocks come from `recommended-plugins.json`, not retyped).
- [x] Task 5.2: Include it in the base README through the existing generated-block mechanism (`build-plugin.mjs`), between markers; `--check` covers it.
- [x] Task 5.3: Export the block for the landing track (AM-10125); this track does not edit `landing/`.

**Impact**: One source for the README and the website.

## Phase 6: Tests

**Problem**: The behaviour is Markdown an agent follows, so the tests pin its contract: the table, the ranking, the texts and the build.
**Solution**: A reference classifier over fixture projects as the oracle, parity checks between it and `ops/next.md`, text tests, catalog tests.

- [x] Task 6.1: `connector/test/helpers/next-fixtures.mjs`: builds a fixture repository in a temporary directory with its own `git init` (the `makeRepo` helper) from a compact description (tracks with lane, status, extra markers, stub or real plan, optional last comment, optional branch merged or not, optional age of the last commit through `GIT_COMMITTER_DATE`); one description per state S01 to S21 plus the multi-candidate ranking cases, each with its expected state id, track and command.
- [x] Task 6.2: `connector/test/helpers/next-reference.mjs`: the reference classifier (state id, ranked candidates) implementing REQ-6 to REQ-20 over a fixture directory; no shipped code uses it.
- [x] Task 6.3: `connector/test/next.test.mjs`: (a) every fixture gives the expected state, track and command through the reference; (b) the table of `ops/next.md` has exactly the ids S01 to S21, each with a command cell that matches the fixture's expected command shape; (c) the ranking list in `ops/next.md` has the six steps in REQ-19's order; (d) `next` is in the catalog with the group, the argument and the example; (e) it is listed by `help`, the generated base command, the parallel profile's prompt list and `docs/plugin-map.md`; (f) the generated command is read only (no `update_track` or `create_track` in its text); (g) the recommendation block is injected in `ops/next.md` for both add-ons and equals the setup block (one source); (h) the text rules of REQ-32 on `ops/next.md`, `commands/next.md`, the README journey block and the help line.
- [x] Task 6.4: Extend `connector/test/commands.test.mjs`' expected name list and `connector/test/plugin-coverage.test.mjs` for `next`; extend `connector/test/settings.test.mjs` for the `next.level` row; extend `connector/test/directory-base.test.mjs` so the base still contains no file type other than Markdown and the known assets after this change.
- [x] Task 6.5: Run the whole connector suite: `cd connector && npm test` (the project's own command; it spawns no workers), and `node scripts/build-plugin.mjs --check`. Check for leaked processes afterwards.

**Impact**: A change to the table, the order or the wording fails a test.

## Phase 7: Walk-through

**Problem**: Fixtures cannot show that an agent following the Markdown names the right step.
**Solution**: A scripted walk-through on a scratch repository, then one on a real project.

- [ ] Task 7.1: Run the scratch-repository walk-through of `test.md` (scratch directory outside this checkout, its own `git init`), recording for each step what `next` printed; fix `ops/next.md` where the agent misread it, then rerun.
- [ ] Task 7.2: The same on the Fiti PLUG project, by the owner (a real project with the plugins installed and a real history); record the result in the track's conversation.
- [ ] Task 7.3: Run `next` once in each of: an empty folder, this repository (many tracks, older-format indexes, a summary with lint noise), and a project with the older lane names; note anything surprising.

**Impact**: Evidence that the first version works on real state, not only fixtures.

## Phase 9: A shorter first run (owner feedback from a real first run, 2026-11-19)

The owner ran `next` and then `setup` in a fresh copy of a real project and found both messages too long to read. Plan: S02 in `ops/next.md` shows the one next step, one line on what it does and one line pointing to `/laneconductor:next explain`; the lane primer, the three paths, the board note and the add-ons note move to the explain level or to the moment they are relevant; it asks nothing twice (no "say go" before a command that itself asks for confirmation); it states only what it has checked (it said 5 commits where the repository had 7).

- [x] Task 9.1: Shorten S02 (and S03, S04 where they repeat the same extras) to the step, one line of what it does and one pointer to the explain level; keep the explain level as it is
- [x] Task 9.2: Remove the double confirmation: a card whose command asks for confirmation itself does not end with "say go"
- [x] Task 9.3: Counts and other facts in a card come from a command that was run for that purpose (for example `git rev-list --count HEAD`), never from a truncated listing; say so in the text
- [x] Task 9.4: Text tests (the S02 card has no primer, no board note and no add-ons note at the default level, and the explain level still has them; the size of `next` does not grow), and update the ops-text-versus-code comparison

## Phase 10: The first track after setup (owner feedback from a second real first run, 2026-11-19)

After setup the owner saw: setup closing with "run /laneconductor:next", then `next` printing the whole lane primer (the after-setup state S04 had no short card). The owner's direction: show the result instead of telling the person to run `next`; before asking to create a track, offer to see the project on the board, and suggest a few tracks drawn from what was seen (privacy, security, anything a quick look of the code finds), plus the person's own.

- [x] Task 10.1: A short card for S04 (set up, no tracks yet): one line "Next: your first track", then up to four suggested tracks, each one line with the reason taken from a fact setup already read (README, package.json, .gitignore, the file layout, git history), the board line, and "or name your own"; no lane primer at the default level (the explain level keeps it)
- [x] Task 10.2: The suggestions are honest: only facts already read (a README that says no licence, no CI files, no lint config, a public-demo README, no SECURITY or LICENSE file, and so on), no claim of a finding that was not verified; the audit track is always offered as the last suggestion ("Audit: review the code for privacy, security and quality, and file each finding as its own track"); at most four items
- [x] Task 10.3: The board line: when the board add-on is installed, `/laneconductor:board` (it shows the project files that setup wrote and later the tracks); when it is not, one line with the add-on install command, shown and never run
- [x] Task 10.4: Picking a suggestion creates the track with the existing `new` procedure (search first, then create); picking several creates several; nothing is created before the person answers
- [x] Task 10.5: Text tests (the S04 card has the suggestions, the board line and the own-title option, no primer, at most four items, the audit item last) and keep the size of `next` from growing; update the ops-text-versus-code comparison

## Phase 11: Suggestions that come from the project itself (owner feedback from a real first run, 2026-11-19)

The four first suggestions (licence, secrets, CI, audit) were generic and not interesting; the useful list appeared only when the owner asked about the project, and it came from the project's own `docs/plan.md`. Direction: for an EXISTING project, analyse it and offer valuable next things, at first run and later on; for a NEW project, brainstorm and start the new-project workflow with suggested skills.

- [x] Task 11.1: The S04 card (set up, no tracks yet) leads with the project's own stated plan: items from `docs/plan.md`, `ROADMAP.md`, `TODO.md` or a roadmap, next-steps or status section of the README, each in the plan's own wording and order, naming its source file; the plan's open decisions appear as questions, not as tracks; at most four shown with "N more in <file>"; the generic items (licence, secrets, CI, audit) come after, only when the plan does not already cover them, at most two, the audit last
- [x] Task 11.2: "File all N" (and picking numbers) creates the tracks through the `new` procedure (search first), in the plan's order, in the plan lane, with the plan item as the problem statement and its source file named; nothing is created before the person answers
- [x] Task 11.3: Later on: when nothing is ready to rank (the queue is empty, done or blocked), `next` offers the items of the project's plan documents that have no track yet (compared with the existing track titles and problems, conservative: when unsure, show it as "may already be a track"), as the same short card; written once and shared with S04
- [x] Task 11.4: A new or empty project (no code to analyse, no plan document) routes to the new-project workflow: a brainstorm interview, the scaffold, the first tracks and the starter set of suggested skills; check by a headless run that the empty-folder card names `/laneconductor:new-project` and that the workflow ends with the first-track card and the suggested skills
- [x] Task 11.5: Freshness noise: a repository with no upstream, or a regenerated summary, is not by itself a "state may be stale" line in `next`; unpushed commits, a stale claim and the like still are
- [x] Task 11.6: Text tests (S04 leads with the plan items and their source, generic items second and fewer than three, the later-on suggestions, no invented item, the empty-folder route) and keep the size of `next` from growing

## Phase 12: One reply from a fresh project to a track ready to plan (owner direction, 2026-11-19; release 1.9.5, after Phase 11)

Goal: reduce friction and give the fastest value. Today a first run takes four turns (next, setup, "ok", pick tracks). Direction: `/laneconductor:next` on a fresh project does the read-only analysis and shows what it found; ONE reply (`go`) then does the full setup, files the suggested tracks, and ends offering the board and planning the first track. A brand-new project starts the brainstorm and new-project process instead.

- [x] Task 12.1: S02 for an existing project: the card shows what the analysis found (the project in one line, the plan items and their source, as in Phase 11) and offers exactly one reply, `go`, which means: set up LaneConductor, declare the track privacy, file the first four plan items as tracks in the plan lane, and stop at the closing offer; the card says in one clause what `go` will create. `next` itself stays read-only: the `go` reply makes Claude run the setup procedure (the model already invokes the setup command from the user's "go")
- [x] Task 12.2: S02 for a brand-new project (an empty folder, or a repository with no code and no plan document): the card says it is a new project and offers `go` to start the brainstorm (the new-project interview), which explores options and decisions before writing files, then the scaffold, first tracks and suggested skills
- [x] Task 12.3: The closing after `go` offers exactly two things: see it on the board (`/laneconductor:board`, with the add-on install line when it is not installed) and plan the first track (`/laneconductor:plan 1`, naming its title); one question, no commit question
- [x] Task 12.4: Text tests for the two cards and the closing, a size check (next must not grow), and a headless end-to-end check of the whole sequence on a fixture with a plan document, on an empty folder, and on a project that already has `conductor/`

## Phase 13: A short closing message when a lane finishes (owner feedback from a real planning run, 2026-11-19; release 1.9.7)

After `/laneconductor:plan 1` finished, the chat message ran to about 35 lines: four phases, twelve test cases, findings, three decisions, two next steps. The owner's direction: when planning finishes, give a short overview and a way to see more, and point to the board, where the card carries the next step's instruction.

- [x] Task 13.1: The closing chat message of a lane command (plan first, then implement, review, quality-gate, merge) is at most about six lines: the outcome in one line (what was done, where the track now sits), the decisions or answers needed from the person (at most three, each one line; they block the next step so they stay), the next step as one command, and one "more" line: `/laneconductor:board` (the card shows the next step with a Copy button) or say "show the plan"; findings, phase and test-case lists and the rest go into the track's files and its one completion comment, not into the chat
- [x] Task 13.2: Written once and shared where several lane commands inline the same text (the lane commands must not grow; `run` must stay under 68 KB); keep the completion comment rule (one `> **system**:` line) as it is
- [x] Task 13.3: The board card of a track that finished its lane shows the next step and its Copy button (it does for plan:success today); check the same for the other lanes and fix gaps
- [x] Task 13.4: Text tests (each lane guide's closing is short and has the four parts; the plan guide no longer asks for a findings list in chat) and a headless check of `plan 1` on a fixture, with the line count of the closing message

## Phase 8: Stronger signals when the audit tracks land (deferred, not part of this release)

This phase stays unchecked on purpose: it depends on other tracks, and the first version must not be reported as complete against it. Each task is a small edit of `ops/next.md` and the reference classifier.

- [ ] Task 8.1: When AM-10136 ships: read `ready_to_resume` and `blocked_by` from the connector in place of the local computation (S09, S10); a missing Waiting Reason is then a lint, not only a human question.
- [ ] Task 8.2: When AM-10141 ships: read `Run Started` and `Run By` for S07 and S08 in place of the commit-age heuristic; mention who holds the claim.
- [ ] Task 8.3: When AM-10135 ships: drop the explicit `lane: done` query and the own ancestor check where `list_tracks` and the board already carry the merged truth (S11 to S13).
- [ ] Task 8.4: When AM-10139 ships: drop the first-marker-wins handling of S21 for tracks the parser now reads, keep the report for the ones it cannot.
- [ ] Task 8.5: When AM-10145 ships `Part Of`: skip epics as candidates and name an epic's derived progress in one line; show `Priority` in `list_tracks`.
- [ ] Task 8.6: When AM-10124 ships: the explain level may add one line naming a skill that helps at this lane.
