# Track 10115: Plugin v2: prompts after a lane ends, commands, a plan-review agent, and board card actions

## Phase 1: Hooks (the plugin does the follow-up a skill cannot)

Facts verified in the hooks reference (2026-11-17): events include SessionStart, UserPromptSubmit, PreToolUse (can ask, deny or rewrite input), PostToolUse (adds context), Stop (can ask Claude to continue), SubagentStop, PreCompact (stdout becomes compaction instructions), FileChanged (literal filenames), WorktreeCreate/Remove; handler types command, http, mcp_tool, prompt, agent; the connector's tools are matched as `mcp__plugin_laneconductor_lc__<tool>` (the connector is part of the one `laneconductor` plugin, server key `lc`; a hook in the separate hooks extension can match them by that full name); SessionStart runs before MCP servers exist (use a command hook, not mcp_tool). A hook cannot publish an artifact (only Claude can), so "update the board automatically" means a hook that makes Claude do it. Not used on purpose: http hooks (nothing leaves the machine), the agent hook type (experimental, costs a subagent per event).

**PLACEMENT (2026-11-17, track 10106 decision: one main plugin, hooks as a separate extension):** hooks run scripts and run on every session and tool call, so they are NOT in the main `laneconductor` plugin (which holds the skill, commands, agents, connector and board script). They live in a separate, small, opt-in extension plugin, `laneconductor-hooks` (`dependencies: ["laneconductor"]`, scripts and `hooks/hooks.json` only, no package.json), removable by uninstalling it. It is not built yet: this phase builds it. Sources go in `connector/plugin-extras-hooks/` and the generator gets a third profile `hooks` that writes `plugins/laneconductor-hooks` and adds a second marketplace entry (the main plugin's `FULL_EXTRAS_DIRS` extension point is only for things that must stay in the main plugin). Hooks that match the connector's tool names (H2, H5) use the prefix `mcp__plugin_laneconductor_lc__*`. Until the extension ships, the main plugin's skill carries a "Habits" section with H1, H2 and H5 as plain rules plus "say what will be pushed and ask first"; a hook, when built, makes the same habit certain instead of requested.

- [ ] Task 1: Plugin extras live in `connector/plugin-extras/` (commands and agents, done) and, for hooks/hooks.json and scripts/*.sh, in `connector/plugin-extras-hooks/` (see PLACEMENT above); the `hooks` profile of `scripts/build-plugin.mjs` copies them into the generated `plugins/laneconductor-hooks`; one shared script helper decides "is this a LaneConductor project" and reads the options (`.laneconductor.json` `board.auto_update`, `hooks.*`)
- [ ] Task 2 (H1, SessionStart and after compaction): print a 5-line brief: tracks in flight, board age, unpushed commits, dirty state files, and the one-line writer rule; silent when there is no `conductor/tracks/`
- [ ] Task 3 (H2, PostToolUse on create_track/update_track): record a "board is stale" marker (under `.git/`, never in the working tree) and add one line for Claude: offer the next step (update the board, review the plan, continue); only when a lane or Lane Status changed
- [ ] Task 4 (H3, Stop, opt-in `board.auto_update: true`): once per turn, if the stale marker is set and `board.artifact_url` exists, ask Claude to republish the board (the `board` procedure) and clear the marker; guard against loops with the Stop hook's active flag; default off, where it only says "the board is out of date" once per session
- [ ] Task 5 (H4, PreToolUse on `Bash(git push*)`): run the privacy scanner (`connector/src/scan.mjs`) over the added lines of the commits that would be pushed; deny on a match with file and line only; allow otherwise; never block when the scanner itself fails (report and allow)
- [ ] Task 6 (H5, PreToolUse on Write and Edit of `conductor/tracks/*/index.md`): when the connector tools exist, `ask` once with "use update_track (conflict-safe) instead of editing markers by hand"; never deny
- [ ] Task 7 (H6, PreCompact): print compaction instructions: keep track numbers touched, decisions and their reasons, unpushed commits, open agents, and the board URL
- [ ] Task 8 (H7, FileChanged on `conductor/tracks-summary.md`): when it changes under a running session, add one line "track state changed outside this session; re-read before editing"
- [ ] Task 8b (H9, SubagentStart and SubagentStop): append one line per subagent run to `.git/lc-activity.jsonl` (track number if the agent name or prompt carries one, agent type, start, end, outcome); `lc board` reads it so the board can show "running now" and the session brief (H1) can list agents still open; this is how a human sees that work is happening
- [ ] Task 9: `userConfig` option `hooks` (default on) plus per-hook switches in `.laneconductor.json`; all scripts validate under `claude plugin validate --strict` and the pre-checks (command paths use only `${CLAUDE_PLUGIN_ROOT}`, no package launcher, no network); recorded-input tests for every script (lane moved vs progress only, secret in diff, no tracks folder, option off)
- [ ] Task 10 (HUMAN): in a real Claude Code session confirm: brief at start, offer after a lane move, board republished at the end with `board.auto_update`, a push with a fake secret denied, the compaction note kept; record the time each hook adds

## Considered and left out (reasons)
- UserPromptSubmit rewriting prompts: the skill already routes "plan X" and "update the board"
- TaskCompleted mapping to track Progress: guesses progress from Claude's own to-do list; wrong numbers would look authoritative
- WorktreeCreate/Remove: replaces Claude's worktree creation; too invasive for the gain
- http and agent hooks: see above

## Phase 2: Commands, the track-runner subagent, and the coverage test (do this phase first; Phase 1 hooks need its generator hook-up)

- [x] Task 1: `scripts/build-plugin.mjs` copies `connector/plugin-extras/` (commands/, agents/) into the generated plugin (hooks and scripts go to the separate `laneconductor-hooks` extension, Phase 1); `claude plugin validate --strict` and the pre-checks still pass
- [x] Task 2: Commands for every row of the Coverage table in the spec (thin files, one description line each, body only points at the skill procedure and the connector tool); `$ARGUMENTS` is the track number or title
- [x] Task 3: The `track-runner` subagent (`agents/track-runner.md`, `isolation: worktree`, tools limited to what a lane needs): works one track through the lane the command names, in its own worktree, using the connector for track state and git for code; reports a one-paragraph result; never merges or pushes without the human
- [x] Task 4: `/laneconductor:run N` and the implement/review commands RECOMMEND the subagent (one per track, worktree per track, the lessons in `ops/working-a-track.md`: commit and push before branching, no `git add -A` in a worktree, check for leaked processes after tests) and show the exact dispatch; they start nothing unasked
- [x] Task 5: `connector/plugin-extras/coverage.json` lists the skill-only and automatic rows with reasons; the coverage test parses the generated SKILL.md routing table and fails on an unmapped row (so a new skill command cannot ship without a plugin action)
- [x] Task 6: `plan-reviewer` subagent (read-only) and `/laneconductor:review-plan N`
- [ ] Task 7: README and skill text name the commands; the skill's "How to run a command" section says the plugin's commands are the entry points
- [ ] Task 8 (HUMAN): in Claude Code, `/laneconductor:status`, `:plan`, `:run` on a scratch repo; confirm the subagent recommendation and that nothing starts unasked

## Phase 3: Act from the board (spike, then build)

- [ ] Task 1: Spike with the `mcp` capability against the local connector as a host server (name pattern `host:plugin_laneconductor_lc`, UNVERIFIED) in the desktop app; record the result in this plan
- [ ] Task 2: If it works, or once the remote connector exists: one write action (set lane) with a confirm step in the page, `base` handling and CONFLICT shown to the user
- [ ] Task 3: Skip this phase's build entirely if the spike fails and the remote connector is not ready; say so here

## Phase 4: Board card actions (owner decision 2026-11-18: both steps)

Step 1 shows each card's next step with its exact command and a Copy button, everywhere. Step 2 adds a Move menu that exists only where the page can reach the local connector. Running work is never a page action: only the command is copied.

- [x] Task 1: `connector/src/board-actions.mjs` (pure): the action of one track from its markers, the dependency state, the stale-claim check and the workflow (next lane through the shared resolver); `buildBoard` adds `action` to live tracks and attention rows, `boardPageData` carries it as `x`; `lc-board.mjs` passes the parsed workflow
- [x] Task 2: Page, step 1: action line on every card, in every Needs-attention row (new Next step column) and in the drawer header; Copy inside the click handler, selection fallback, "Copied"; safe DOM, theme variables, wrapping at 375 px, focus and aria-labels; the controls do not open the card
- [x] Task 3: Page, step 2: Move menu behind `claude.use('mcp')`, lazy probe of `host:plugin_laneconductor-parallel_lc` on the first click, `get_track` then `update_track`, confirm step, done-lane tick with `reopen: true`, CONFLICT and other failures told apart, card moves with the snapshot note; an absent capability draws nothing
- [x] Task 4: Fake-DOM tests with `claude.use('mcp')` stubbed for present, absent, unreachable, CONFLICT and success (test.md TC-6 to TC-12); generator run, `--check` clean
- [ ] Task 5 (HUMAN): the board is published with `capabilities.mcp` declaring `{server: "host:plugin_laneconductor-parallel_lc", tools: ["get_track", "update_track"]}`; in the Claude desktop app confirm the real server name (`listTools` shows it), the first-use consent, a successful Move and a CONFLICT; in a browser tab confirm no Move is drawn. Record the result here (this also answers Phase 3 Task 1)

## Phase 5: Project drawer, What's next panel, freshness and Refresh, one board command (owner decisions 2026-11-18, spec items 3 to 5)

Build order from the spec: Project drawer, then the What's next panel (the ranking is extracted into shipped code first), then the first-run text, then freshness and the single board command. Released in plugins 1.4.0 (Project drawer), 1.5.0 (What's next panel), 1.6.0 (freshness chip, Refresh board, one board command); the card actions of Phase 4 are in 1.3.0.

- [x] Task 1: Project drawer: a **Project** button in the board header opens every definition file as a tab (Overview, Tech stack, Workflow drawn as a flow with the lane and status primer, Quality gate, KPIs, Guidelines, Stories, Deployment); the same secret, email and phone scan as the track documents; `board.include_docs: false` turns it off; `.laneconductor.json` is never published (spec item 3, AC-10)
- [x] Task 2: What's next panel: a **What's next** button and panel with the command, a Copy button, what it does, why, the Also waiting list and the primer; one shipped ranking in `connector/src/next.mjs` shared by the board and `/laneconductor:next`; first-run text so that, when the board add-on is installed, `/laneconductor:board` and its What's next button show the same step (spec items 4 and 5, AC-11)
- [x] Task 3: Freshness and refresh: a freshness chip, **Check now** (desktop app only, `list_tracks` with limit 1, read-only), a **Refresh board** button in the footer and the header that copies `/laneconductor:board refresh`
- [x] Task 4: One board command: `show-board` and `refresh-board` are removed, `/laneconductor:board [refresh]` is the single board command (`connector/test/board-command.test.mjs`)
- [ ] Task 5: The **Review the plan** sample button in a track's detail view (REQ-4, AC-4): `sample` capability, fixed instruction, plan and spec text only when not withheld by the scan, `not_granted` hides the button; not built
- [ ] Task 6 (HUMAN): real desktop-app check of the Move menu and Check now: the server string `host:plugin_laneconductor-parallel_lc` is unverified (same check as Phase 4 Task 5)
- [ ] Task 7 (HUMAN): visual check of the board at 375 px width and in the light and dark themes (Project drawer, What's next panel, freshness chip, Move menu); the tests check the source only, not a browser
- [ ] Task 8: Track type on the board: `board.json` carries the track `Type` only when it is not dev; a small text label on the card and drawer for marketing, sales, support and other; type filter chips shown only for types present, combined with search and the backlog section, remembered per viewer; tests; no owner-action fields yet

**Impact**: The plugin does the follow-up work a skill cannot, and the board becomes a place to review and act.
