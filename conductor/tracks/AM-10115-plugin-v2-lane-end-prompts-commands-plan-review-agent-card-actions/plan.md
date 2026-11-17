# Track 10115: Plugin v2: prompts after a lane ends, commands, a plan-review agent, and board card actions

## Phase 1: Hooks (the plugin does the follow-up a skill cannot)

Facts verified in the hooks reference (2026-11-17): events include SessionStart, UserPromptSubmit, PreToolUse (can ask, deny or rewrite input), PostToolUse (adds context), Stop (can ask Claude to continue), SubagentStop, PreCompact (stdout becomes compaction instructions), FileChanged (literal filenames), WorktreeCreate/Remove; handler types command, http, mcp_tool, prompt, agent; a plugin's own connector tool is matched as `mcp__plugin_laneconductor_lc-connector__<tool>`; SessionStart runs before MCP servers exist (use a command hook, not mcp_tool). A hook cannot publish an artifact (only Claude can), so "update the board automatically" means a hook that makes Claude do it. Not used on purpose: http hooks (nothing leaves the machine), the agent hook type (experimental, costs a subagent per event).

- [ ] Task 1: Plugin extras live in `connector/plugin-extras/` (hooks/hooks.json, scripts/*.sh, commands, agents) and `scripts/build-plugin.mjs` copies them into the generated plugin; one shared script helper decides "is this a LaneConductor project" and reads the options (`.laneconductor.json` `board.auto_update`, `hooks.*`)
- [ ] Task 2 (H1, SessionStart and after compaction): print a 5-line brief: tracks in flight, board age, unpushed commits, dirty state files, and the one-line writer rule; silent when there is no `conductor/tracks/`
- [ ] Task 3 (H2, PostToolUse on create_track/update_track): record a "board is stale" marker (under `.git/`, never in the working tree) and add one line for Claude: offer the next step (update the board, review the plan, continue); only when a lane or Lane Status changed
- [ ] Task 4 (H3, Stop, opt-in `board.auto_update: true`): once per turn, if the stale marker is set and `board.artifact_url` exists, ask Claude to republish the board (the `board` procedure) and clear the marker; guard against loops with the Stop hook's active flag; default off, where it only says "the board is out of date" once per session
- [ ] Task 5 (H4, PreToolUse on `Bash(git push*)`): run the privacy scanner (`connector/src/scan.mjs`) over the added lines of the commits that would be pushed; deny on a match with file and line only; allow otherwise; never block when the scanner itself fails (report and allow)
- [ ] Task 6 (H5, PreToolUse on Write and Edit of `conductor/tracks/*/index.md`): when the connector tools exist, `ask` once with "use update_track (conflict-safe) instead of editing markers by hand"; never deny
- [ ] Task 7 (H6, PreCompact): print compaction instructions: keep track numbers touched, decisions and their reasons, unpushed commits, open agents, and the board URL
- [ ] Task 8 (H7, FileChanged on `conductor/tracks-summary.md`): when it changes under a running session, add one line "track state changed outside this session; re-read before editing"
- [ ] Task 8b (H9, SubagentStart and SubagentStop): append one line per subagent run to `.git/lc-activity.jsonl` (track number if the agent name or prompt carries one, agent type, start, end, outcome); `lc board` reads it so the board can show "running now" and the session brief (H1) can list agents still open; this is how a human sees that work is happening
- [ ] Task 9: `userConfig` option `hooks` (default on) plus per-hook switches in `.laneconductor.json`; all scripts validate under the directory pre-checks (command paths use only `${CLAUDE_PLUGIN_ROOT}`, no package launcher, no network); recorded-input tests for every script (lane moved vs progress only, secret in diff, no tracks folder, option off)
- [ ] Task 10 (HUMAN): in a real Claude Code session confirm: brief at start, offer after a lane move, board republished at the end with `board.auto_update`, a push with a fake secret denied, the compaction note kept; record the time each hook adds

## Considered and left out (reasons)
- UserPromptSubmit rewriting prompts: the skill already routes "plan X" and "update the board"
- TaskCompleted mapping to track Progress: guesses progress from Claude's own to-do list; wrong numbers would look authoritative
- WorktreeCreate/Remove: replaces Claude's worktree creation; too invasive for the gain
- http and agent hooks: see above

## Phase 2: Commands, the track-runner subagent, and the coverage test (do this phase first; Phase 1 hooks need its generator hook-up)

- [x] Task 1: `scripts/build-plugin.mjs` copies `connector/plugin-extras/` (commands/, agents/, hooks/, scripts/) into the generated plugin; the directory pre-checks and `claude plugin validate --strict` still pass
- [x] Task 2: Commands for every row of the Coverage table in the spec (thin files, one description line each, body only points at the skill procedure and the connector tool); `$ARGUMENTS` is the track number or title
- [x] Task 3: The `track-runner` subagent (`agents/track-runner.md`, `isolation: worktree`, tools limited to what a lane needs): works one track through the lane the command names, in its own worktree, using the connector for track state and git for code; reports a one-paragraph result; never merges or pushes without the human
- [x] Task 4: `/laneconductor:run N` and the implement/review commands RECOMMEND the subagent (one per track, worktree per track, the lessons in `ops/working-a-track.md`: commit and push before branching, no `git add -A` in a worktree, check for leaked processes after tests) and show the exact dispatch; they start nothing unasked
- [x] Task 5: `connector/plugin-extras/coverage.json` lists the skill-only and automatic rows with reasons; the coverage test parses the generated SKILL.md routing table and fails on an unmapped row (so a new skill command cannot ship without a plugin action)
- [x] Task 6: `plan-reviewer` subagent (read-only) and `/laneconductor:review-plan N`
- [ ] Task 7: README and skill text name the commands; the skill's "How to run a command" section says the plugin's commands are the entry points
- [ ] Task 8 (HUMAN): in Claude Code, `/laneconductor:status`, `:plan`, `:run` on a scratch repo; confirm the subagent recommendation and that nothing starts unasked

## Phase 3: Act from the board (spike, then build)

- [ ] Task 1: Spike with the `mcp` capability against the local connector as a host server (name pattern `host:plugin_laneconductor_lc-connector`, UNVERIFIED) in the desktop app; record the result in this plan
- [ ] Task 2: If it works, or once the remote connector exists: one write action (set lane) with a confirm step in the page, `base` handling and CONFLICT shown to the user
- [ ] Task 3: Skip this phase's build entirely if the spike fails and the remote connector is not ready; say so here

**Impact**: The plugin does the follow-up work a skill cannot, and the board becomes a place to review and act.
