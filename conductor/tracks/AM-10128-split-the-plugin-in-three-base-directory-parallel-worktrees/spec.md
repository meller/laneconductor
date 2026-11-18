# Spec: Split the plugin in three: base (directory), parallel (worktrees, safe writes), board

## Problem Statement

Decision (human, 2026-11-18): the directory portal blocks the all-in-one plugin for an organization that is not Verified (local MCP server, package.json and lockfile, scripts, the agent key `isolation`). So the product becomes three plugins from one generator, installed from the owner's marketplace `meller/laneconductor`; only the first is submitted to Anthropic's directory (for discoverability).

The owner's requirement (2026-11-18, also stated in plan.md): the three plugins must WORK TOGETHER, and the owner installs all three on their own computer to check it. So interoperability is tested, not assumed.

## The three plugins

1. `laneconductor` (base, public, in the directory): Markdown only. The skill with its lane guides and skill suggestions, all commands, the read-only `plan-reviewer` agent, README, LICENSE, icon, plugin.json with only fields the portal knows plus `privacyPolicyUrl`. It does the whole plan-first process by editing the track files directly. It carries no connector tool calls, no scripts, no `isolation` key.
2. `laneconductor-parallel` (add-on, our marketplace only): parallel work in git worktrees. The local connector (conflict-checked writes so several sessions and sub-agents can write track state at once, automatic commits, freshness warnings, generated track summary, secret and personal-data scan, advice log and health report, MCP prompts), the scaffold script, and the `track-runner` agent WITH `isolation: worktree` (one sub-agent per track, each in its own worktree). Its MCP tools become `mcp__plugin_laneconductor-parallel_lc__*`.
3. `laneconductor-board` (add-on, our marketplace only): the board script and its page, published by Claude as a private artifact. It works without the connector.

## Requirements

- REQ-1 One generator, three outputs: `scripts/build-plugin.mjs` builds all three plugins and `.claude-plugin/marketplace.json` from the same sources and one catalog; `--check` covers all three plus the marketplace file.
- REQ-2 Layout: `plugins/laneconductor` becomes the base (the directory plugin path stays `plugins/laneconductor`); the connector and agents move to `plugins/laneconductor-parallel`; the board script to `plugins/laneconductor-board`; `.claude-plugin/marketplace.json` lists all three. Track 10127 (the Markdown-only build and Lite naming) is the first step: reuse its profile and fold it into this layout; its funnel text and privacy page stay.
- REQ-3 Base: Markdown only, as described above, and it passes the directory portal's blocking rules (emulated in tests).
- REQ-4 No hard dependency between the plugins (the base comes from the directory, the add-ons from our marketplace, and cross-marketplace dependencies are unverified); each works alone and they work best together.
- REQ-5 Detection: Claude sees which tools and commands exist. When the connector tools or the board script are present the base uses them and recommends nothing. When they are missing the base mentions the add-on once per session, only when relevant (the person asks for a board, mentions several sessions, people or sub-agents writing the same tracks, worktrees, or wants automatic commits, a privacy scan or health report), shows the install commands (`claude plugin marketplace add meller/laneconductor`, then `claude plugin install laneconductor-parallel@laneconductor` or `laneconductor-board@laneconductor`, then `/reload-plugins`), and NEVER runs an install itself. The directory policy bans listings that exist mainly as advertising, so the base must be useful alone and the pointers short.
- REQ-6 The base's board commands find the board script by Glob and, when absent, show the install commands. The base's commands use the connector tools only when they are present; the generator maps the plain tool names to the add-on's prefix.
- REQ-7 Migration: people on the all-in-one `laneconductor@laneconductor` (0.x) would lose the connector if they update to the new base. Bump to a new major version (1.0.0) for the base, write a short migration note in the README and the plugin READMEs (uninstall the all-in-one, install the base and the add-ons you want), and tell existing users once. The files in git are unchanged, so nothing is lost.
- REQ-8 Connector fixes from a failing otralingo session (2026-11-18): (a) the connector rejects `update_track` when a project's workflow.json uses other lane names than the skill's (otralingo has planning, in-progress; the skill says plan, implement; its statuses are queue, running, success, failure, waiting, and `in_progress` was rejected). The error is correct but unhelpful: add a suggestion of the nearest valid lane or status (for example implement to in-progress) and put the valid lanes and statuses in `get_track` and `get_context` so the first write succeeds. (b) A user saw "Connection closed" and could not get the connector's tools back; not reproduced (the installed 0.3.0 and 0.5.0 servers answer list_tracks and get_track for that project, and its log is healthy through 11:33), but the server cannot leave a trace of why it exits: add handlers for uncaught exceptions and unhandled rejections that log the reason to stderr and keep serving, and a short exit-reason line. (c) Running connector processes keep the plugin version they started with; say in the update note that sessions must be restarted after a plugin update.
- REQ-9 Interoperability is tested: an automated matrix over the generated folders (base alone, base + parallel, base + board, all three), a stdio smoke test of the add-on connector, and a scripted try-it-yourself for the owner.
- REQ-10 Directory: the portal's Validate on the base is run as a check only; the owner submits.

## Decisions

- 2026-11-18: Three plugins from one generator and one catalog (`connector/plugin-extras/recommended-plugins.json`), installed from the owner's marketplace `meller/laneconductor`; only the base is submitted to Anthropic's directory.
- 2026-11-18: No hard dependency between the plugins (cross-marketplace dependencies are unverified).
- 2026-11-18: The base never runs an install; it shows the commands and the person runs them.
- 2026-11-18: The base moves to a new major version, 1.0.0, with a migration note; the add-ons start at 1.0.0.
- 2026-11-18: The interface between the plugins (script path, tool prefix, server key `lc`) is written down in connector/ARCHITECTURE.md.
- 2026-11-18 (owner): The split stays, because Anthropic's directory accepts only the Markdown-only base (it blocks the local MCP server, scripts and package files for non-verified organisations). The full version (base, board, parallel) is offered in ONE line: a single `&&` chain of the install commands now, and, only if a test shows it is worth it, an optional empty fourth plugin `laneconductor-full` that only depends on the other three. No combined plugin with duplicated content. The visible command set shrinks: help in three tiers, `bug` and `feature` folded into `new`, `status` possibly dropped. Details in the next section.

## One command for the full version, and fewer visible commands (owner, 2026-11-18)

Owner decision of 2026-11-18, added on top of the split; nothing above changes.

### 1. The split stays

Anthropic's directory accepts only the Markdown-only base: for organisations that are not verified it blocks the local MCP server, scripts and package files. So the base is the directory entry and the discovery funnel, and the add-ons stay in the owner's marketplace `meller/laneconductor`.

### 2. The full version (base, board, parallel) in one line

- Step 1 (now): a single `&&` chain of the install commands, built from the catalog (`connector/plugin-extras/recommended-plugins.json`, new lines `full_install` and `addons_install`). It is shown on the website, in the READMEs and, inside Claude when BOTH add-ons are missing, in `next` and in setup (show-not-run: the person runs it, Claude never does). One shared block, one source, so the text cannot drift.
- Step 2 (after a test with `scripts/try-local.sh`): an optional EMPTY fourth plugin `laneconductor-full` that only declares dependencies on the other three. To be offered only if `claude plugin install` installs dependencies automatically (UNVERIFIED today) AND the one-liner still feels clumsy. If the test fails or the one-liner is good enough, no fourth plugin: go/no-go is recorded here.
- No combined plugin with duplicated content: it would clash with the directory version's `/laneconductor:` command names (two plugins registering the same commands).

### 3. Fewer visible commands

- Group the help output in three tiers: start here (`next`, `setup` or `new-project`, `board`); lanes (`plan`, `implement`, `review`, `quality-gate`, `merge`); more (the rest).
- Fold `bug` and `feature` into `new` with an argument (for example `new bug ...`, `new feature ...`).
- Consider dropping `status` (`board` and `next` cover it).
- Keep natural-language use: people can still say "file a bug as a track" and the skill routes it; only the visible command list shrinks.
- Trim the size of the carried command text: the `run` command is about 51 KB. Open question for the directory reviewer: is 300 to 700 lines per command acceptable?

### Acceptance criteria (this decision)

- [ ] AC-1 The directory entry stays the Markdown-only base and the add-ons stay in the owner's marketplace; the split is unchanged by this decision.
- [ ] AC-2 The catalog has the lines `full_install` and `addons_install`, and one shared block built from them is the only source of the one-line install text.
- [ ] AC-3 The one-line `&&` chain is shown on the website, in the READMEs and, when both add-ons are missing, in `next` and setup; it is shown, never run.
- [ ] AC-4 A try-local test of a dependency-only `laneconductor-full` plugin is done and a go/no-go is recorded (does `claude plugin install` install dependencies automatically; is the one-liner still clumsy).
- [ ] AC-5 If built, `laneconductor-full` is empty (no commands, skills, agents or scripts), only depends on the other three and is offered only after the go decision; no combined plugin with duplicated content exists.
- [ ] AC-6 The help output is grouped in three tiers: start here (`next`, `setup` or `new-project`, `board`), lanes (`plan`, `implement`, `review`, `quality-gate`, `merge`), more (the rest).
- [ ] AC-7 `bug` and `feature` are folded into `new` with an argument and natural-language requests for a bug or feature track still work.
- [ ] AC-8 The decision on removing `status` is recorded, and if it is removed `board` and `next` cover what it showed.
- [ ] AC-9 The carried command text is trimmed (the `run` command was about 51 KB) and the directory reviewer is asked at submission whether 300 to 700 lines per command is acceptable; the answer is recorded.

## Data model and API

- Plugin folders: `plugins/laneconductor` (base), `plugins/laneconductor-parallel`, `plugins/laneconductor-board`; marketplace file `.claude-plugin/marketplace.json` with three entries, base first.
- Connector tool names of the add-on: `mcp__plugin_laneconductor-parallel_lc__*` (server key `lc`).
- Board script found by the base through the Glob `**/laneconductor-board/**/bin/lc-board.mjs` (searched only in the installed-plugins cache).
- `get_track` and `get_context` list the valid lanes and statuses; `update_track` answers a VALIDATION_FAILED with the nearest valid lane or status.

## Acceptance criteria

Ticked where a committed test or the repository itself shows it; the tests were read, not re-run for this tidy.

- [x] Three plugin folders exist, the marketplace lists them with the base first, and the base holds no script, package file, `.mcp.json` or `isolation` key while the parallel add-on's `track-runner` has it (REQ-1, REQ-2, REQ-3; plugin-build.test.mjs, directory-base.test.mjs).
- [x] The base passes the emulated portal rules and the add-ons are blocked by them (REQ-3; directory-base.test.mjs).
- [x] The matrix over the generated folders validates every plugin, finds no duplicate command or skill name, finds the board script by the Glob only when the add-on is present and shows the install commands otherwise (REQ-5, REQ-6, REQ-9; interop.test.mjs).
- [x] The base's tool prefix equals the add-on's real tool names, read over stdio (REQ-6, REQ-9; interop.test.mjs).
- [x] The lane-name suggestion, the valid lanes and statuses in `get_track` and `get_context`, and the exit-reason and uncaught-error logging exist (REQ-8; lane-names.test.mjs).
- [x] The base README, each plugin README and the root README carry a migration note for 0.x users that includes restarting sessions (REQ-7, REQ-8c).
- [x] `scripts/try-local.sh` exists and is tested (REQ-9; try-local.test.mjs).
- [ ] Every base command runs by editing the track files and the funnel text never tells Claude to run an install (REQ-3, REQ-5). A static text test exists; running every command is not verified.
- [ ] docs/why-laneconductor.md, the landing install box and the wiki describe the three plugins (REQ-7). Not verified: why-laneconductor.md has no mention of the add-ons and the landing install box shows only the base install.
- [ ] The owner has installed all three from the local marketplace and the checks in test.md TC-10 pass (REQ-9). Not verified.
- [ ] The portal's Validate on `plugins/laneconductor` has no blocking issues and the owner has submitted (REQ-10). Not verified.
- [ ] A release note was sent to existing 0.x users (REQ-7). Not verified.

## Risks and limits

- Running connector processes keep the version they started with; sessions must be restarted after a plugin update.
- The "Connection closed" report was not reproduced; the logging only makes a future occurrence traceable.
- Cross-marketplace dependencies are unverified, which is why there is no hard dependency; a person who installs only the base never gets the add-ons' behaviour.
- The directory policy bans listings that exist mainly as advertising, so the pointers to the add-ons must stay short and relevant.
- People on 0.x who update without reading the migration note lose the connector until they install the add-on; their files in git are unchanged.
- Whether `claude plugin install` installs declared dependencies automatically is UNVERIFIED; the optional `laneconductor-full` plugin depends on it (step 2 above).
- Removing or folding commands (`bug`, `feature`, `status`) changes the visible command set for existing users; natural-language use and the help text must keep them able to find the new forms.

## Out of scope

- Submitting to the directory (the owner does it).
- Deploying the landing page or the wiki (only when the owner says so).
- Running any install from the base.
