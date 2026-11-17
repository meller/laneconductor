# Spec: Plugin v2: prompts after a lane ends, commands, a plan-review agent, and board card actions

## Problem Statement

Use what a plugin can do and a skill cannot, and make the board a place to act, not only to look.

Verified in the Claude docs (2026-11-17): a plugin can ship hooks, commands and subagents next to its skill and connector; hooks and agents load in Claude Code and Cowork but not in claude.ai chat; a hook can match the connector's tool by its full name (`mcp__plugin_laneconductor_lc__update_track`); a published artifact can ask Claude a question of its own (the `sample` capability, a separate memoryless model call, consent on first use) and can call the viewer's connectors (the `mcp` capability, with the viewer's credentials).

Wanted: (1) after a lane finishes, Claude offers the next step: update the board, review the plan, move on; offers only, never actions (second opinion, never a controller), switchable off. (2) Commands for the common asks: /laneconductor:board and /laneconductor:review-plan. (3) A plan-review subagent that reads spec.md and plan.md and reports gaps. (4) On the board, opening a track card shows a "Review the plan" button that asks Claude from inside the page and shows the review (read-only). (5) Later, card buttons that change a track (move lane, set status) through a connector the page can reach: the remote connector once it exists, or possibly the plugin's local one in the Claude desktop app (unverified, needs a spike).

Out of scope here: install and migration documentation (track 10114) and the directory submission (track 10106 Phase 5e).

## Requirements

- REQ-1: A separate, opt-in extension plugin, `laneconductor-hooks` (`dependencies: ["laneconductor"]`; the main `laneconductor` plugin has no hooks), ships a small set of hooks (hooks/hooks.json plus plain shell scripts named by `${CLAUDE_PLUGIN_ROOT}/...`). Every hook is cheap (under 100 ms), silent outside a LaneConductor project (no `conductor/tracks/`), never prints secrets or file bodies, and never blocks except the pre-push privacy guard. Hooks only run in Claude Code and Cowork. The set, in priority order (full catalog and reasons in plan Phase 1):
  H1 SessionStart: a short "where things stand" brief (in-flight tracks, stale board, unpushed commits) and the writer rule. H2 PostToolUse on the connector's create/update tool: mark the board stale and offer the next step. H3 Stop (opt-in `board.auto_update`): once per turn, if tracks changed, ask Claude to republish the board. H4 PreToolUse on `git push`: scan the outgoing diff with the privacy scanner and deny on a match (names file and line, never the text). H5 PreToolUse on Write/Edit of a track's index.md: nudge to use the connector (ask, never block). H6 PreCompact: tell compaction to keep track numbers, decisions and unpushed work. H7 FileChanged on the generated summary: tell this session another writer changed track state. H8 SessionStart again after compaction: re-inject H1.
- REQ-2: Commands `/laneconductor:board` and `/laneconductor:review-plan <track>` exist as thin entry points to the skill procedures; no new logic.
- REQ-3: A subagent `plan-reviewer` (plugin `agents/`) reads a track's spec.md and plan.md through the connector and returns gaps, missing tests and unclear tasks. Read-only tools only; its output is advice.
- REQ-4: The board page declares the `sample` capability. A "Review the plan" button in a track's detail view sends the track's plan and spec text (already loaded for the drawer, never anything withheld by the privacy scan) with a fixed instruction, and shows the answer, with a note that it is a separate Claude call and changes nothing. Consent is asked by the platform on first use; handle `not_granted` by hiding the button.
- REQ-5 (spike first): the board page declares the `mcp` capability for a connector and offers one write action (set a track's lane) through `update_track`. Whether the plugin's local connector can be reached as a host server from the desktop app is UNVERIFIED and must be tested before any promise; the remote connector (10106 Phases 7-9) is the supported path.
- REQ-6: Everything in this track keeps the plugin passing `claude plugin validate --strict` and the directory pre-checks (hook command paths use only `${CLAUDE_PLUGIN_ROOT}`; new files are text, under 256 KiB).

## Coverage: every skill command has a plugin action (map, checked by a test)

| Skill command (routing table) | Plugin action | Notes |
|---|---|---|
| `plan`, `brainstorm`, `implement`, `review`, `qualityGate`, `merge`/`done` | commands `/laneconductor:plan N`, `:brainstorm N`, `:implement N`, `:review N`, `:quality-gate N`, `:merge N` | thin entry points: load the lane guide with the connector's `get_context`, read the track with `get_track`, follow the lane file; `implement` and `review` recommend the track-runner subagent |
| `run track N` (end to end) | command `/laneconductor:run N` + subagent `track-runner` (frontmatter `isolation: worktree`) | recommends one subagent per track in its own worktree, mirrors `ops/working-a-track.md`; never starts one unasked |
| `newTrack`, `reportaBug`, `featureRequest` | commands `/laneconductor:new`, `:bug`, `:feature` | call the connector's `create_track` (`track_kind` bug or feature) |
| `status` | command `/laneconductor:status [N]` | `list_tracks` / `get_track` |
| `move`, `pulse`, `updateTrack` | command `/laneconductor:move N <lane>` and the connector's `update_track` | markers only, with `base` and CONFLICT handling |
| `comment` | command `/laneconductor:comment N` | `append_conversation` |
| `board`, `show the board`, `update the board` | command `/laneconductor:board` | the existing `ops/board.md` procedure |
| `workflow`, `workflow set` | command `/laneconductor:workflow` | reads and edits `conductor/workflow.json` |
| `init-tracks-summary` | automatic | the connector regenerates the summary on every write; `lc summary` remains for plain edits |
| `revert` | skill only | needs judgement about which commit; reason recorded in `connector/plugin-extras/coverage.json` |
| `delete` | skill only | destructive and "only when named"; reason recorded |
| `setup`, `setup scaffold`, `setup-deploy`, `deploy` | commands `/laneconductor:setup`, `:deploy` (only when named) | thin entry points to the shipped setup and deploy guides |

A test parses the routing table of the generated SKILL.md and fails if a row is neither mapped to a command file in `plugins/laneconductor/commands/` nor listed with a reason in `coverage.json` as skill-only or automatic.

## Acceptance Criteria

- [ ] AC-1: Finishing a lane through the connector in Claude Code makes Claude offer the next step once; with the option off it does not.
- [ ] AC-2: `/laneconductor:board` and `/laneconductor:review-plan 10106` run the existing procedures.
- [ ] AC-3: The plan-reviewer subagent returns a review for a real track and changes no file.
- [ ] AC-4: In the board, "Review the plan" returns a review inside the page, read-only, with the platform consent on first use.
- [ ] AC-5: The spike records whether a card button can change a track through a connector, with the exact server name used, or records that it cannot.
- [ ] AC-6: The coverage test passes: no skill command exists without a plugin action or a recorded reason.
- [ ] AC-7: `/laneconductor:run 10106` recommends the track-runner subagent in a worktree and shows the command it would run; it starts nothing without a yes.
- [ ] AC-8: A subagent run is visible: SubagentStart and SubagentStop hooks write one line per run (track, agent, start, end, result) and the board shows "running now".
