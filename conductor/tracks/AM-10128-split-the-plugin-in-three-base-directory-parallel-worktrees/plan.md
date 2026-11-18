# Track 10128: Split the plugin in three: base (directory), parallel (worktrees, safe writes), board

The design is in spec.md. The owner's requirement (2026-11-18): the three plugins must WORK TOGETHER, and the owner installs all three on their own computer to check it. So interoperability is tested, not assumed.

## Phase 1: One generator, three outputs

- [ ] Task 1: `scripts/build-plugin.mjs` builds `plugins/laneconductor` (base, Markdown only), `plugins/laneconductor-parallel` and `plugins/laneconductor-board` from the same sources; `--check` covers all three and `.claude-plugin/marketplace.json` (three entries, base first)
- [ ] Task 2: Tool-name mapping: commands and guides use plain tool names; the generator writes the add-on prefix `mcp__plugin_laneconductor-parallel_lc__*` where the base mentions connector tools (only as `if present`)
- [ ] Task 3: Versions: base 1.0.0; add-ons start at 1.0.0 and the interface between them (script path, tool prefix, server key `lc`) is written down in connector/ARCHITECTURE.md

## Phase 2: The base

- [ ] Task 1: Fold in track 10127's Markdown-only build and renaming; the base keeps the name `laneconductor` and the namespace `/laneconductor:`
- [ ] Task 2: Detection and funnel text (one source): use the add-on's tools or script when present and recommend nothing; when missing, mention the add-on once per session, only when relevant, show the install commands, never run them; the pointers stay short (directory policy)
- [ ] Task 3: Board commands find the board script by Glob (`**/laneconductor-board/**/bin/lc-board.mjs`) and otherwise show the install commands
- [ ] Task 4: Without the add-on, `/laneconductor:run` explains how to do parallel work by hand (git worktree) and says what the add-on adds (isolated sub-agents, safe shared state)

## Phase 3: laneconductor-parallel (worktrees)

- [ ] Task 1: The connector, its server key `lc`, the scaffold script, package.json and lockfile move here; tools become `mcp__plugin_laneconductor-parallel_lc__*`
- [ ] Task 2: The `track-runner` agent WITH `isolation: worktree` and the connector tools in its `tools` list
- [ ] Task 3: Connector fixes from the otralingo finding: suggest the nearest valid lane or status on VALIDATION_FAILED; list the valid lanes and statuses in `get_track` and `get_context`; handlers for uncaught exceptions and unhandled rejections that log the reason and keep serving; an exit-reason line on stderr

## Phase 4: laneconductor-board

- [ ] Task 1: The board script and its page move here and work with the base alone (no connector needed)

## Phase 5: Interoperability (the owner's requirement)

- [ ] Task 1: Automated matrix over the generated folders: base alone, base + parallel, base + board, all three. For each: every plugin validates (`claude plugin validate --strict`), no two plugins register the same command or skill name, the base's board command finds the board script when the add-on folder is present and shows the install commands when it is not, the base's connector-tool prefix matches the add-on's real tool names (read over stdio from the running add-on server)
- [ ] Task 2: A stdio smoke test of the add-on connector with the new prefix and the lane-name suggestion (otralingo-style workflow.json with `planning` and `in-progress`)
- [ ] Task 3: A scripted try-it-yourself: `scripts/try-local.sh` (or documented commands) that adds the repository as a LOCAL marketplace (`claude plugin marketplace add <path>`), installs the three at local scope into a scratch repository, and prints what to type
- [ ] Task 4 (HUMAN): The owner installs all three from the local marketplace on their computer and runs the checks in test.md; results recorded here

## Phase 6: Docs, migration, landing

- [ ] Task 1: README, plugin READMEs and docs/why-laneconductor.md describe three plugins and how they fit; migration note for people on the all-in-one 0.x (uninstall it, install the base and the add-ons you want, restart sessions)
- [ ] Task 2: Landing install box and the wiki (one directory install plus two add-on commands); deploy only when the owner says so

## Phase 7: Directory (the owner submits)

- [ ] Task 1: Push; the lead re-runs the portal's Validate on `plugins/laneconductor` (a check only) until the blocking list is empty
- [ ] Task 2 (HUMAN): the owner answers the data-handling questions, ticks the acknowledgements and submits

**Impact**: People find the base in the directory and get the full plan-first process; the add-ons give parallel worktrees with safe shared state and the board, and everything works together.
