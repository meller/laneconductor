# Tests: Track 10144 - What's next: a state-aware command that names the next step and explains it (onboarding as a tutorial)

## Test Commands

- Whole connector suite (the project's own command, no worker is spawned): `cd connector && npm test` (runs `node --test "test/*.test.mjs"`).
- Only this track's tests: `cd connector && node --test test/next.test.mjs test/commands.test.mjs test/plugin-coverage.test.mjs test/settings.test.mjs test/directory-base.test.mjs test/base-no-daemon-text.test.mjs test/no-lc-text.test.mjs`.
- Generated files are current: `node scripts/build-plugin.mjs --check` (exit 0).
- After the runs: `ps aux | grep -E "node|lc-connector"` and `readlink /proc/<pid>/cwd` for each hit; stop only processes this session started.
- Do not run the worker-spawning or mock-CLI suites from a worktree.

## Fixture projects

Built by `connector/test/helpers/next-fixtures.mjs` in a temporary directory, each with its own `git init` and one commit on `main` (so a fixture can never resolve to an enclosing checkout). A track is written as `AM-NNNNN-slug/index.md` with the header markers; "stub" means the plan or test file is the placeholder created with the track; "age" is set with `GIT_COMMITTER_DATE` on the fixture's commit. Unless stated, the workflow is the one of `WORKFLOW_JSON` in `connector/test/helpers/repo.mjs`, where `plan` ends at `plan:success`.

| Fixture | Setup | Expected state | Expected card names | Command |
|---------|-------|----------------|---------------------|---------|
| F01 | A folder with files and no `.git` | S01 | setup, `git init` offered first | `/laneconductor:setup` |
| F02a | A repository with 40 commits and a `package.json`, no `conductor/` | S02 (default: continue) | three paths, continue marked; add-ons that fit | `/laneconductor:setup` |
| F02b | An empty folder with a `git init` and no files | S02 (default: new project) | three paths, start a new project marked | `/laneconductor:new-project` |
| F03 | `conductor/` with no `workflow.json` | S03 | finish the scaffold | `/laneconductor:setup` |
| F04 | Set up, `conductor/tracks/` empty | S04 | create the first track, example phrase from the project name; add-ons that fit | `/laneconductor:new <title>` |
| F05a | 10001 `plan:queue` with `Waiting for reply: yes` | S05 | answer first | `/laneconductor:comment 10001 <your answer>` |
| F05b | 10001 `implement:waiting`, no `Waiting On Tracks`, no `Depends On` | S05 | a question or approval waits | the same |
| F05c | 10001 `plan:queue`, `conversation.md` ends with a human entry and nothing after it | S05 | unanswered comment | the same |
| F06a | 10001 `implement:failure` | S06 | retry implement | `/laneconductor:implement 10001` |
| F06b | 10001 `done:failure` | S06 | fix the cause, then merge again | `/laneconductor:merge 10001` |
| F07 | 10001 `implement:running`, last commit 9 hours old | S07 | a question: is anything still working on it | `/laneconductor:move 10001 implement:queue` |
| F08 | 10001 `implement:running`, last commit 5 minutes old; 10002 `plan:queue` | S08 for 10001, then S18 | leave 10001 alone; name 10002 | `/laneconductor:plan 10002` |
| F09 | 10001 `done:success`; 10002 `plan:waiting`, `Waiting On Tracks: 10001` | S09 | resume | `/laneconductor:move 10002 plan:queue` |
| F10 | 10001 `done:queue`; 10002 `plan:waiting`, `Waiting On Tracks: 10001` | S11 for 10001; 10002 blocked | merge 10001; 10002 named as blocked | `/laneconductor:merge 10001` |
| F11 | 10001 `done:queue`, branch `track-10001` exists and is not merged | S11 | merge (asks before a push) | `/laneconductor:merge 10001` |
| F12 | 10001 `done:queue`, branch `track-10001` merged into `main` | S12 | looks merged, confirm | `/laneconductor:move 10001 done:success` |
| F13 | 10001 `done:waiting` with a `PR URL` | S13 | the pull request waits | `/laneconductor:move 10001 done:success` (after merge) |
| F14 | 10001 `quality-gate:queue` | S14 | run the quality gate | `/laneconductor:quality-gate 10001` |
| F15 | 10001 `review:queue`; a second case with `implement:success` and a workflow with no `on_success` for implement | S15 | review | `/laneconductor:review 10001` |
| F16a | 10001 `implement:queue`, real plan and real tests | S16 | implement | `/laneconductor:implement 10001` |
| F16b | 10001 `plan:success`, real plan and real tests | S16 | implement | `/laneconductor:implement 10001` |
| F17 | 10001 `implement:queue`, plan stub | S17 | plan first | `/laneconductor:plan 10001` |
| F18 | 10001 `plan:queue` | S18 | plan | `/laneconductor:plan 10001` |
| F19 | Only `backlog:queue` tracks, 10001 oldest | S19 | pick one to start | `/laneconductor:move 10001 plan:queue` |
| F20 | Every track `done:success` | S20 | nothing waits; new, board, status | `/laneconductor:new <title>` |
| F21a | 10001 with two `Lane` blocks; 10002 `plan:queue` | S21 reported; 10002 named | name 10002; one line about 10001 | `/laneconductor:plan 10002` |
| F21b | Two folders numbered 10001; no other track | S21 | name both, fix by hand | none |
| F22 | Older lane names (`planning`, `in-progress`), 10001 `planning:queue` | S18 | plan, written with the project's lane name | `/laneconductor:plan 10001` |
| F23 | The multi-candidate ranking case (below) | by REQ-19 | one named, rest in one line | see below |
| F24 | A project with `.laneconductor.json` holding `{"next":{"level":"short"}}` and the same tracks as F18 | S18, short card | one line | `/laneconductor:plan 10001` |
| F25 | A project with 12 tracks, 4 of them in review, quality-gate or done, and no settings file | `auto` resolves to short | one line | any |
| F26 | The same as F18 with the `laneconductor-parallel` add-on detected (tool prefix present in the fixture's tool list) | S18, no add-on offer | the parallel add-on is not mentioned | `/laneconductor:plan 10001` |

F23, the ranking fixture: 10001 `plan:queue`; 10002 `implement:queue` with real plan; 10003 `review:queue`; 10004 `done:queue` (not merged); 10005 `plan:queue` with `Priority: high`; 10006 `implement:failure`; 10007 `plan:waiting` with `Waiting for reply: yes`; 10008 `plan:waiting` on 10001. Expected order of the card: 10007 (human reply), then 10006 (failure), then 10005 (high priority), then 10004 (latest lane), 10003, 10002, 10001; 10008 is blocked and named in the "also" line. Variants: remove 10007, the first is 10006; remove 10006 too, the first is 10005; remove the priority marker, the first is 10004; remove 10004, the first is 10003. Two tracks in the same state and lane: the lower number first.

## Test Cases

### Phase 1: The procedure text and the skill edits

- [ ] TC-1: `ops/next.md` exists in the source skill and has a table whose first column is exactly S01 to S21, once each - expected: the parity test finds the 21 ids and no other id.
- [ ] TC-2: The ranking section of `ops/next.md` lists six steps in the order of REQ-19 - expected: the steps' leading words are, in order, human reply, failed or stuck, ready to resume, priority, lane order, number.
- [ ] TC-3: The `SKILL.md` routing table has a `next` row and the markers table has a `Priority` row - expected: both found.
- [ ] TC-4: `ops/settings.md` has a `next.level` row whose values are `auto`, `explain`, `short` and default `auto` - expected: found; `settings.test.mjs` still passes.
- [ ] TC-5: `setup/setup.md` and `ops/new-project.md` end with a line pointing to `/laneconductor:next` and still carry the generated-recommendation marker - expected: both strings present in each file.

### Phase 2: The catalog entry, the generated texts and the build

- [ ] TC-6: `COMMAND_NAMES` contains `next` once; group `start here` is first in `GROUPS`; `help` is in the same group; the argument is optional - expected: `commands.test.mjs` passes with the new name in its list.
- [ ] TC-7: `help` (the base command file, the MCP prompt and the help tool) lists `next` before the `plan and deliver` group, with its example phrase "what's next" - expected: the three outputs agree and contain the line.
- [ ] TC-8: `plugins/laneconductor/commands/next.md` exists with `argument-hint: "[explain | short | track number]"`, names `ops/next.md`, and contains none of `update_track`, `create_track`, `append_conversation` - expected: pass (read only).
- [ ] TC-9: The parallel profile lists `next` among its MCP prompts and the generated line for it says the tools are for reading - expected: `plugin-coverage.test.mjs` and the new test pass.
- [ ] TC-10: `docs/plugin-map.md` lists `next` in the base commands and in the parallel prompts - expected: `node scripts/build-plugin.mjs --check` exits 0.
- [ ] TC-11: The recommendation block in `plugins/laneconductor/skills/laneconductor/ops/next.md` is byte for byte the block in `setup/setup.md` of the same build, and names `laneconductor-parallel` and `laneconductor-board` each with two install commands, each command alone in its own bash fence - expected: equal; four fences.
- [ ] TC-12: Changing a `why` line in `recommended-plugins.json` changes the text in `setup`, `new-project` and `next` after a rebuild, and no add-on sentence is typed by hand - expected: grep of the `ops/next.md` source finds no add-on sentence outside the marker.

### Phase 3: Closing hints

- [ ] TC-13: The first lines of `help` contain "Not sure where to go? Use `next`" - expected: found in the base command, the prompt and the tool output.
- [ ] TC-14: `BASE_HABITS` carries the two edits (the status line ends with `next`; "offer exactly one next step" is the card of that track) - expected: both phrases present in the base `SKILL.md`.
- [ ] TC-15: The server instructions mention the `next` prompt and stay under 4,096 characters - expected: KC-8 passes.
- [ ] TC-16: The `new`, `bug` and `feature` procedures and `create-track.mjs` are byte-identical to their state on the branch point - expected: `git diff <base> -- connector/src/tools/create-track.mjs` is empty and the three procedure strings are unchanged.

### Phase 4: Levels and the personal setting

- [ ] TC-17: F24 (setting `short`): the card is one line; the same fixture with `next explain` gives the full card plus the primer - expected: line counts differ as specified, the primer has at most 12 lines.
- [ ] TC-18: F25 (a mature project, no file): `auto` resolves to short; F04 (no tracks): `auto` resolves to explain - expected: matches.
- [ ] TC-19: A missing, empty, invalid-JSON or unknown-valued settings file gives `auto` and the card is the same as with no file (one line about invalid JSON allowed) - expected: no failure, no write.
- [ ] TC-20: Saying "always short" in a fixture with no settings file: the card asks before creating `.laneconductor.json` and before adding the ignore line; on yes the file holds only `next.level`; on no nothing is written - expected: file system diff matches.
- [ ] TC-21: Running `next` in every fixture changes no tracked or untracked file (`git status --porcelain` before and after) except TC-20's write - expected: identical.

### Phase 5: The journey text

- [ ] TC-22: `NEXT_JOURNEY` is generated from the catalog and appears in the base README between its markers; `--check` fails if the README block is edited by hand - expected: pass and fail respectively.
- [ ] TC-23: The block mentions the three first-run outcomes and the add-on install commands only through the generated block, and has no sentence about work that is not shipped - expected: the text rules of TC-27 pass on it.

### Phase 6: The state table (fixtures and the reference classifier)

- [ ] TC-24: Every fixture F01 to F26 yields its expected state id, track and command through the reference classifier - expected: all green, one assertion per row of the fixture table.
- [ ] TC-25: The ranking cases (F23 and its variants) yield the order of REQ-19 - expected: the exact order stated above; ties by lower number.
- [ ] TC-26: A `done:queue` track counts as not shipped for S10 (a dependent stays blocked) and as shipped only when `done:success` - expected: F10 blocks 10002; F09 resumes it.

### Text rules (the base stays free of daemon-era words, no `lc` command, Markdown only)

- [ ] TC-27: `ops/next.md`, the generated `commands/next.md` and the README block contain none of `make install`, `laneconductorrc`, `worker`, `workers`, `collection`, `daemon` (the base test's own pattern), no `lc ` subcommand (the pattern of `no-lc-text.test.mjs`), no track number (`10\d\d\d`), no `legacy`, and none of: "coming soon", "will be added", "in a future", "later version", "roadmap" - expected: no hits. The lane name `backlog` and state S19 are allowed by an explicit anchor in the test.
- [ ] TC-28: Nothing under `plugins/laneconductor` gains a file that is not Markdown, and no `.mjs`, `.json` or `.sh` file is added to the base by this track - expected: the file list of the base differs from the previous build only by `.md` files.
- [ ] TC-29: The base command names no tool other than Read, Glob, Grep and read-only git in its own steps; every `mcp__plugin_laneconductor-parallel_lc__` name in it is a read tool (`list_tracks`, `get_track`, `get_context`) - expected: pass.
- [ ] TC-30: No shipped text calls the daemon or worker tier "legacy" and none names it; where an internal file must name it (this track's files), it says "experimental, currently unmaintained" - expected: grep of shipped files finds neither word.

### Phase 7: Walk-through on a scratch repository (human-judged, an agent runs it)

Use a scratch directory outside this checkout. Each step shows what to type and what `next` must name.

```bash
mkdir -p "$SCRATCH/walk" && cd "$SCRATCH/walk" && git init -q -b main
```

- [ ] TC-31: Empty folder. Type `/laneconductor:next`. Expected: S02 with the three paths, start a new project marked as default, the add-ons that fit with install commands in their own bash fences, nothing installed or written.
- [ ] TC-32: Say `look around`. Expected: four sentences on what LaneConductor is and the `help` list; no file written (`git status --porcelain` empty).
- [ ] TC-33: Type `/laneconductor:new-project a habit tracker`, answer the interview, accept the scaffold. Expected: it ends with "Next: run `/laneconductor:next`", asks before any commit, does not repeat the add-on offer.
- [ ] TC-34: Type `/laneconductor:next`. Expected: the walking-skeleton track in `plan:queue` is named with its plan command, one sentence on what the plan lane writes, one on why before code, the link to `ops/lanes-and-statuses.md`, and the explain primer (young project).
- [ ] TC-35: Run the plan. Type `/laneconductor:next`. Expected: S16 (`plan:success` with a real plan): implement, with the sub-agent and worktree recommendation only if the parallel add-on is installed.
- [ ] TC-36: Run implement, then `next`. Expected: review. Run review, then `next`: quality gate. Run the gate, then `next`: merge, "asks before any push".
- [ ] TC-37: Leave a comment for the human and set `Waiting for reply: yes` on a second track; type `next`. Expected: that track is named before the merge (human reply first).
- [ ] TC-38: Merge, then `next`. Expected: S20, or the next track; the merged track is not named.
- [ ] TC-39: Type `next short`, then `next explain`, then say "always short" and say yes. Expected: one line; the primer; the file `.laneconductor.json` holds `next.level` and `.gitignore` has the line; a later `next` is one line.
- [ ] TC-40: Mark a track `running` and age its commit; type `next`. Expected: the stale question; no marker changed.
- [ ] TC-41: Repeat TC-31 with the parallel add-on installed in the session. Expected: the add-on is not mentioned; `next` mentions the freshness line of the connector only when it says stale.
- [ ] TC-42: The owner runs the same on the Fiti PLUG project and records what was wrong or unclear in the track's conversation.
- [ ] TC-43: Run `next` in this repository. Expected: it names one step in under a minute of reading, ignores the lint noise of `conductor/tracks-summary.md`, reports its damaged tracks in one line each and does not rank them.

### Phase 8: Deferred signals (not part of this release)

- [ ] TC-44: After AM-10136: `ready_to_resume` and `blocked_by` agree with the local computation on F09 and F10 - expected: same states.
- [ ] TC-45: After AM-10141: S07 uses `Run Started`; S08 names `Run By` - expected: same states, a better sentence.
- [ ] TC-46: After AM-10145: a track that other tracks name with `Part Of` is not a candidate - expected: an epic fixture is skipped.

## Acceptance Criteria

- [ ] All unit tests pass (`cd connector && npm test`), and `node scripts/build-plugin.mjs --check` exits 0.
- [ ] No regressions in `help`, setup, the board commands or the parallel add-on's prompts.
- [ ] Phase 7 recorded, with the owner's real-project run (TC-42) or the owner's note that it is postponed.
- [ ] Phase 8 stays unchecked, so the track is not reported complete against signals owned by other tracks.
