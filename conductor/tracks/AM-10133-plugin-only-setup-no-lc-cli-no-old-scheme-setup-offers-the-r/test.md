# Tests: Track 10133 - Plugin-only setup: no lc CLI, no old scheme, setup offers the recommended plugins

## Test Commands

Run from the repository root of the track's worktree. These tests build the plugins in memory and write only to temp folders; the connector tests may start the connector over stdio, so after every run check for leftovers.

- One file: `node --test connector/test/no-lc-text.test.mjs`
- The affected set: `cd connector && node --test test/no-lc-text.test.mjs test/base-no-daemon-text.test.mjs test/setup-walkthrough.test.mjs test/recommendations.test.mjs test/newproject-scaffold.test.mjs test/newproject-existing.test.mjs test/plugin-map.test.mjs test/plugin-build.test.mjs test/commands.test.mjs test/board.test.mjs test/board-docs.test.mjs test/board-page.test.mjs test/interop.test.mjs test/directory-base.test.mjs test/addons.test.mjs`
- Whole connector suite: `cd connector && npm test`
- The generated output is current: `node scripts/build-plugin.mjs --check` (exit 0)
- Leaked processes after any run: `ps aux | grep -E "lc-connector|probe.mjs|lc-board" | grep -v grep` must be empty; for any pid left over, read `/proc/<pid>/cwd` before stopping it, and stop only the ones the run started.
- Do not run `conductor/tests/*` (worker-spawning) from a worktree.
- The grep gate (also what TC-1 does): see TC-1.

## Test Cases

### Phase 1: Settings
- [x] TC-1: `ops/settings.md` exists in the source skill and in the built base; it lists exactly the keys `connector.state_branch`, `connector.push`, `board.artifact_url`, `board.include_docs`, `board.include_conversation`, `project.name`, says the file is optional and personal, and names the `.gitignore` line - expected: the file is present in `buildPlugin(REPO, 'base')` and matches
- [x] TC-2: parity: scan `connector/src/state-branch.mjs`, `push-policy.mjs`, `board-docs.mjs`, `connector/bin/lc-board.mjs` for the config keys they read - expected: every key found is listed in `ops/settings.md`, and every listed key is read somewhere
- [x] TC-3: `renderScaffold(answers)` does not contain `.laneconductor.json`; `writeScaffold` on an empty temp repo leaves no such file; `.gitignore` gets the three lines it got before (and the settings line only when D1 says setup adds it at scaffold time) - expected: the scaffold file map has no `.laneconductor.json`
- [x] TC-4: an existing repository with an OLD `.laneconductor.json` (`{"mode":"local-api","project":{"id":4},"collectors":[]}`): `resolveStateBranch`, `readPushPolicy`, the board script and the scaffold all run with no `problem`, no warning and no rewrite of the file (byte-identical afterwards) - expected: file unchanged, no error text
- [x] TC-5: a `.laneconductor.json` that is not valid JSON: the connector and the board script say so once for the keys they would read and carry on with defaults (state branch from `origin/HEAD`, push policy `ask`) - expected: existing behaviour kept (`push-policy` already reports it)
- [x] TC-6: a new project with no remote on a branch named `main`: the state branch resolves to `main` with no settings file - expected: `source: current_branch`

### Phase 2: Source skill
- [x] TC-7: every inventory item of plan.md section A is gone: the old sentence is not in the file, the replacement is (spot checks by `assert.match` on `lanes/merge.md` for `git merge --no-ff track-NNN` and `gh pr create`, on `SKILL.md` for the Glob form `conductor/tracks/*-<N>-*/`, on `lanes/quality-gate.md` for "by hand" KPI reading) - expected: pass
- [ ] TC-8: the source skill (without `legacy/`) and each generated plugin have no match for the NO_LC pattern of TC-9 - expected: empty hit list per file
- [x] TC-8b: every marker name used by the lane guides is unchanged (`**Lane**`, `**Lane Status**`, `**Progress**`, `**Phase**`, `**Verdict**`, `**KPI Actual**`, `**KPI Snapshot**`, `**PR URL**`, `**Waiting for reply**`) so the connector's marker handling still matches - expected: each marker string still appears in the file that used it
- [x] TC-8c: the lane-guide step numbering of `lanes/implement.md` has no gap after the lock steps are removed (steps are consecutive) - expected: pass
- [x] TC-8d: `lane-skills.test.mjs`, `lanes-reference.test.mjs`, `lane-names.test.mjs`, `workflow-transitions-parity.test.mjs` still pass - expected: unchanged results (the lane files they read keep their structure)

### Phase 3: Commands and scripts
- [x] TC-9: NEW `no-lc-text.test.mjs`. Scope: all files of `plugins/laneconductor`, `plugins/laneconductor-parallel`, `plugins/laneconductor-board` (text files, no `node_modules`, no lockfiles), the same three built in memory, `.claude/skills/laneconductor` except `legacy/`, `connector/plugin-extras/**`, `README.md`, `docs/*.md` (not `docs/superpowers/`), `connector/README.md`, `connector/ARCHITECTURE.md`, `scripts/plugin-texts.mjs`. Pattern NO_LC (a line fails on any): `(^|[^\w./-])lc (?!-)[a-z][a-z-]*\b` restricted to the subcommand list read from `bin/lc.mjs` plus `board|new|move|delete|status|workflow|update-track|report-bug|feature-request|track-dir|worktrees|deploy|setup|setup-deploy|brainstorm|init-summary|summary|worker|start|stop|restart|state|ui|api|logs|config|add-target|list-targets|remove-target|remote-sync|pulse|comment|show|rerun|quality-gate|plan|implement|review|merge`; `which lc`; `command -v lc`; `` `lc` `` unless the line also has `server key`, `MCP key` or `plugin:laneconductor`; `make install`; `laneconductorrc`; `\b(un)?lock\.mjs`; `measure\.mjs`; `init-tracks-summary\.mjs`; `track-dir`; `worktrees (merge|create-pr)`. Allowed: the file names `lc-board.mjs`, `lc-scaffold.mjs`, `lc-connector.mjs`, `lc-summary.mjs` (a hyphen follows), the MCP key, the tool prefix `mcp__plugin_laneconductor-parallel_lc__`, and `plugin:laneconductor:lc` - expected: empty hit list; the failure message names `file:line: text`
- [x] TC-10: the test fails when it should: feed the pattern a fixture with `lc new "x"`, `Run lc board --site d`, `which lc`, `make install`, `node conductor/lock.mjs 5`, and a fixture that is allowed (`lc-board.mjs`, `server key \`lc\``) - expected: five hits, zero hits
- [x] TC-11: `.laneconductor.json` is mentioned in the base only in `ops/settings.md`, `ops/board.md`, `commands/board.md`, `commands/show-board.md`, `commands/refresh-board.md`, `README.md` and `SKILL.md` (the pointer); never in `setup/*`, `ops/new-project.md`, `commands/setup.md`, `commands/new-project.md` - expected: assertion on the allowed list
- [x] TC-12: `helpText()` and `helpData()` carry no `lc` command-line wording; the field is `needs_board_script`; `plugin-map.test.mjs` reads `needsBoardScript` - expected: pass
- [x] TC-13: the board script prints `board: withheld track ...` on stderr and `--check` says `Run: node <path> --out ...` - expected: output has no `lc board`
- [x] TC-14: `show-board` still reads `board.artifact_url` from the settings file and says "no board URL stored" when the file is missing - expected: the generated command text still names the key and the missing-file case

### Phase 4: Setup recommends the plugins
- [x] TC-15: every catalog entry has `setup_fit` (one line, 10 to 200 chars) - expected: `recommendations.test.mjs` passes
- [x] TC-16: the generated block in `setup/setup.md` and `ops/new-project.md` of the base names exactly the catalog's add-ons, with the install commands of `installCommands(name)` each alone in its own ```` ```bash ```` fence (two fences per add-on, one command per fence, nothing else inside), followed by `/reload-plugins` - expected: the fences found in the built text equal the catalog-derived list, in order, and match `.claude-plugin/marketplace.json` (name, source) as `recommendations.test.mjs` already checks for other text
- [x] TC-17: the block says "show" and "never run" and "only with a yes" (match on the generated sentences), says to skip an add-on whose `detect` finds it, and says nothing when nothing fits - expected: the sentences are present; no sentence tells Claude to run an install command
- [x] TC-18: the hook comment `<!-- Starter set: reserved for the skill advisor (track 10124) -->` is still in both `setup/setup.md` and `ops/new-project.md`, and sits after the generated block - expected: `base-no-daemon-text.test.mjs` 4th test passes unchanged, plus an order assertion
- [x] TC-19: no base text recommends an add-on unconditionally outside setup and the triggers of the catalog (the existing `recommendations.test.mjs` no-nag assertions) - expected: pass
- [x] TC-20: the block never names a plugin that is not a catalog entry, and its install commands use only the marketplace name of `marketplace.json` - expected: existing cross-check passes
- [x] TC-21: adding a fake `skillpack` entry to a copy of the catalog (in the test only) yields a new item in the generated block with its own fences - expected: the block is built from the catalog, not hard-coded

### Phase 5: Docs
- [x] TC-22: `README.md`, `connector/README.md`, `docs/privacy.md` pass the NO_LC pattern of TC-9, still contain the install commands of the catalog (the README blocks are generated or checked by `recommendations.test.mjs`) and the sentence that the older stack is kept at the tag `v1-legacy` - expected: pass
- [x] TC-23: `docs/plugin-map.md` is current: `node scripts/build-plugin.mjs --check` exits 0 - expected: 0

### Phase 6: Base and walk-through
- [x] TC-24: `base-no-daemon-text.test.mjs` passes unchanged (no `make install`, rc file, worker, collection or daemon in the base; the legacy text only under `legacy/`; the four tests) - expected: pass
- [x] TC-25: NEW `setup-walkthrough.test.mjs`, deterministic part. Build a temp directory `bin` that holds symlinks to `node` and `git` only; run every child process with `PATH=<that dir>` and `HOME=<temp home with no .laneconductorrc>`; first assert `which lc` finds nothing in that environment. In a scratch git repository shaped like an existing Node project (use the fixture of `newproject-existing.test.mjs`): (1) `lc-scaffold.mjs --detect --dir .` prints `answers`, `evidence`, `existing`; (2) `--answers <file> --dir . --dry-run --no-first-track` lists what it would create and skip and writes nothing; (3) the same without `--dry-run` creates `conductor/*` and the tracks folder, adds the `.gitignore` lines, creates no `.laneconductor.json`, makes no commit; (4) the board script `lc-board.mjs --repo . --site <tmp> --json` prints valid JSON and `board.html` exists; (5) no stdout or stderr of any step matches NO_LC - expected: all five hold
- [x] TC-26: same walk-through with an OLD settings file already in the scratch repo and a fake `lc` script on PATH that writes a marker file when run - expected: the marker file is never created (nothing calls `lc`), the old settings file is byte-identical afterwards, `existing.config` is reported and left alone
- [x] TC-27: the walk-through reads the generated procedure the way a session would: render the `setup` command with `renderCommand`, read the `ops/new-project.md` and `setup/setup.md` of the built base, and assert that following their numbered steps in order names no command that does not exist (every backticked command in them is one of `node <script path>`, `git ...`, `gh ...`, or a connector tool name from the tool list) - expected: pass
- [ ] TC-28 (connector, no `lc`): start the connector over stdio (helpers `mcp.mjs`) against the scratch repo with PATH without `lc`; call `get_context` and `list_tracks` - expected: both succeed; the server never needs `lc`
- [x] TC-29: a no-deletion guard: `git diff --name-status <base>..HEAD` of the track shows no `D` under `bin/`, `conductor/*.mjs`, `ui/`, `cloud/`, `migrations/` (run in the review lane, a command not a suite test) - expected: empty

### Phase 7: Landing (deferred; manual)
- [ ] TC-30: before the owner's go, `git diff --stat -- landing/` of the track's commits is empty - expected: empty
- [ ] TC-31: after the landing phase, `grep -nE "\blc (setup|start|stop|ui|api|status|new|move|board|worker)|make install" landing/wiki.html landing/index.html` finds nothing outside the section the owner labelled Remote - expected: reviewed by the owner

### Phase 8: Real use (HUMAN, not automated)
- [ ] TC-32: Fresh Claude Code session in a scratch repo (`scripts/try-local.sh <scratch>`), `/usr/local/bin/lc` still on PATH: `/laneconductor:setup` - expected: the transcript has no `which lc`, no `lc ...` command, no read of `.laneconductor.json`; a message at the end lists the add-ons that fit with install commands in separate fences; nothing installed
- [ ] TC-33: the same in the Fiti PLUG project - expected: as TC-32; the owner confirms the recommendation made sense for that project
- [ ] TC-34: say "yes, install parallel" in that session - expected: Claude shows the two commands again and waits for the person to run them (the desktop app's Run button), then asks to run `/reload-plugins`; Claude runs no install itself

## Acceptance Criteria

- [x] All unit tests above pass, `node scripts/build-plugin.mjs --check` exits 0, and the whole `cd connector && npm test` suite passes
- [x] No regressions: the lane, workflow, connector, board and plugin-build tests keep their results
- [x] No leaked processes after the test runs
- [ ] TC-32 and TC-33 done by the owner before the track is called complete; the landing phase and Phase 8 stay unchecked until then
