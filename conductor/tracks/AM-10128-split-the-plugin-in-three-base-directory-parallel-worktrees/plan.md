# Track 10128: Split the plugin in three: base (directory), parallel (worktrees, safe writes), board

The design is in spec.md. The owner's requirement (2026-11-18): the three plugins must WORK TOGETHER, and the owner installs all three on their own computer to check it. So interoperability is tested, not assumed.

## Phase 1: One generator, three outputs

- [x] Task 1: `scripts/build-plugin.mjs` builds `plugins/laneconductor` (base, Markdown only), `plugins/laneconductor-parallel` and `plugins/laneconductor-board` from the same sources; `--check` covers all three and `.claude-plugin/marketplace.json` (three entries, base first)
- [x] Task 2: Tool-name mapping: commands and guides use plain tool names; the generator writes the add-on prefix `mcp__plugin_laneconductor-parallel_lc__*` where the base mentions connector tools (only as `if present`)
- [x] Task 3: Versions: base 1.0.0; add-ons start at 1.0.0 and the interface between them (script path, tool prefix, server key `lc`) is written down in connector/ARCHITECTURE.md

## Phase 2: The base

- [x] Task 1: Fold in track 10127's Markdown-only build and renaming; the base keeps the name `laneconductor` and the namespace `/laneconductor:`
- [x] Task 2: Detection and funnel text (one source): use the add-on's tools or script when present and recommend nothing; when missing, mention the add-on once per session, only when relevant, show the install commands, never run them; the pointers stay short (directory policy)
- [x] Task 3: Board commands find the board script by Glob (`**/laneconductor-board/**/bin/lc-board.mjs`) and otherwise show the install commands
- [x] Task 4: Without the add-on, `/laneconductor:run` explains how to do parallel work by hand (git worktree) and says what the add-on adds (isolated sub-agents, safe shared state)

## Phase 3: laneconductor-parallel (worktrees)

- [x] Task 1: The connector, its server key `lc`, the scaffold script, package.json and lockfile move here; tools become `mcp__plugin_laneconductor-parallel_lc__*`
- [x] Task 2: The `track-runner` agent WITH `isolation: worktree` and the connector tools in its `tools` list
- [x] Task 3: Connector fixes from the otralingo finding: suggest the nearest valid lane or status on VALIDATION_FAILED; list the valid lanes and statuses in `get_track` and `get_context`; handlers for uncaught exceptions and unhandled rejections that log the reason and keep serving; an exit-reason line on stderr

## Phase 4: laneconductor-board

- [x] Task 1: The board script and its page move here and work with the base alone (no connector needed)

## Phase 5: Interoperability (the owner's requirement)

- [x] Task 1: Automated matrix over the generated folders: base alone, base + parallel, base + board, all three. For each: every plugin validates (`claude plugin validate --strict`), no two plugins register the same command or skill name, the base's board command finds the board script when the add-on folder is present and shows the install commands when it is not, the base's connector-tool prefix matches the add-on's real tool names (read over stdio from the running add-on server)
- [x] Task 2: A stdio smoke test of the add-on connector with the new prefix and the lane-name suggestion (otralingo-style workflow.json with `planning` and `in-progress`)
- [x] Task 3: A scripted try-it-yourself: `scripts/try-local.sh` (or documented commands) that adds the repository as a LOCAL marketplace (`claude plugin marketplace add <path>`), installs the three at local scope into a scratch repository, and prints what to type
- [ ] Task 4 (HUMAN): The owner installs all three from the local marketplace on their computer and runs the checks in test.md; results recorded here

## Phase 6: Docs, migration, landing

- [ ] Task 1: README, plugin READMEs and docs/why-laneconductor.md describe three plugins and how they fit; migration note for people on the all-in-one 0.x (uninstall it, install the base and the add-ons you want, restart sessions)
- [ ] Task 2: Landing install box and the wiki (one directory install plus two add-on commands); deploy only when the owner says so

## Phase 7: Directory (the owner submits)

- [ ] Task 1: Push; the lead re-runs the portal's Validate on `plugins/laneconductor` (a check only) until the blocking list is empty
- [ ] Task 2 (HUMAN): the owner answers the data-handling questions, ticks the acknowledgements and submits

## Phase 8: one command for the full version and command tiers

Owner decision 2026-11-18 (design in spec.md, section "One command for the full version, and fewer visible commands").

- [ ] Task 1 (8.1): Catalog lines `full_install` and `addons_install` in `connector/plugin-extras/recommended-plugins.json` and the shared block built from them in `next`, setup and the READMEs (show-not-run; shown inside Claude only when both add-ons are missing). In progress 2026-11-18, runner.
- [ ] Task 2 (8.2): The website's second install box shows the one-liner (deploy only when the owner says so)
- [ ] Task 3 (8.3): try-local test of a dependency-only `laneconductor-full` plugin (does `claude plugin install` install dependencies automatically?) and a go/no-go recorded in spec.md
- [ ] Task 4 (8.4): Help tiers: start here (`next`, `setup` or `new-project`, `board`), lanes (`plan`, `implement`, `review`, `quality-gate`, `merge`), more (the rest)
- [ ] Task 5 (8.5): Fold `bug` and `feature` into `new` with an argument; natural-language use keeps working
- [ ] Task 6 (8.6): Decide on removing `status` (`board` and `next` cover it) and record the decision
- [ ] Task 7 (8.7): Trim the size of the carried command text (the `run` command is about 51 KB)
- [ ] Task 8 (8.8): Ask the directory reviewer at submission whether 300 to 700 lines per command is acceptable, and record the answer

**Impact**: People find the base in the directory and get the full plan-first process; the add-ons give parallel worktrees with safe shared state and the board, and everything works together.
