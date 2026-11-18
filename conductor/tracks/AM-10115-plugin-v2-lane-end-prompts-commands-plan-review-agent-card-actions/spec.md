# Spec: Plugin v2: prompts after a lane ends, commands, a plan-review agent, and board card actions

## Problem Statement

Use what a plugin can do and a skill cannot, and make the board a place to act, not only to look.

Verified in the Claude docs (2026-11-17): a plugin can ship hooks, commands and subagents next to its skill and connector; hooks and agents load in Claude Code and Cowork but not in claude.ai chat; a hook can match the connector's tool by its full name (`mcp__plugin_laneconductor_lc__update_track`); a published artifact can ask Claude a question of its own (the `sample` capability, a separate memoryless model call, consent on first use) and can call the viewer's connectors (the `mcp` capability, with the viewer's credentials).

Wanted: (1) after a lane finishes, Claude offers the next step: update the board, review the plan, move on; offers only, never actions (second opinion, never a controller), switchable off. (2) Commands for the common asks: /laneconductor:board and /laneconductor:review-plan. (3) A plan-review subagent that reads spec.md and plan.md and reports gaps. (4) On the board, opening a track card shows a "Review the plan" button that asks Claude from inside the page and shows the review (read-only). (5) Later, card buttons that change a track (move lane, set status) through a connector the page can reach: the remote connector once it exists, or possibly the plugin's local one in the Claude desktop app (unverified, needs a spike).

Out of scope here: install and migration documentation (track 10114) and the directory submission (track 10106 Phase 5e).

## Owner decisions, 2026-11-18: the board is the plugin's user interface

The board with its actions is the plugin's UI: the files in git stay the source of truth, and the board is how a person sees and drives them. Decided: do both card-action steps, add a Project drawer and a What's next panel, and make the board the front door of the first run. (A runner is building step 1 and step 2 below; the rest is planned here.)

1. Card actions, step 1 (works everywhere): every card and every Needs-attention row shows its next step (a short label with the exact command) and a Copy button. Running work is never a page action: only the command is copied, a Claude session runs it.
2. Card actions, step 2 (desktop app only): a Move menu on each card that appears only where the page can reach the local connector (the `mcp` capability, Claude desktop app); otherwise it is not shown. It calls `get_track` then `update_track` (conflict-checked; leaving the done lane needs an explicit confirm and `reopen`). The card moves on screen with a note that the board is a snapshot.
3. Project drawer: one **Project** button in the board header opens a drawer with every project definition as a tab, built like the track drawer and read from the conductor folder at generation time: Overview (product.md), Tech stack (tech-stack.md), Workflow (workflow.json and workflow.md; the lanes drawn as a flow with where each lane sends success and failure, from the shared resolver), Quality gate (quality-gate.md), KPIs (kpis.md), Guidelines (product-guidelines.md, design-language.md, the code styleguides), Stories (user-stories.md). Files that do not exist are not shown. The files go through the same secret, email and phone scan as the track documents; a match is withheld with a stated reason; `board.include_docs: false` turns all documents off including these; settings shown never include tokens.
4. What's next panel: a **What's next** button opens a panel with the one next step (command, what it does, why it comes next) and the other candidates in one line each, plus the short lane primer for newcomers. It is the board version of `/laneconductor:next` and must give the same answer: extract the ranking and the 21-state table that today live as Markdown plus a test-only reference classifier into shipped connector code, used by both the board data and the tests (one source, the same fixtures). Computed at generation time like everything else on the board.
5. Board as the front door: on a first run (no tracks, or right after setup) `next` and setup recommend starting with the board (offering the board add-on from the one catalog, show-not-run), and the board then takes the person through everything with What's next: board, next step, board, next step. The loop is: open What's next, copy the command or press Move, run it in the Claude session, ask for a refresh, look at the board again. The page cannot run work and the text must say so plainly.
6. Honesty and privacy: say it is a snapshot as fresh as its read time; sharing the board shares the project definitions and track documents; nothing planned is announced in the page or in shipped text.

Build order: card actions (steps 1 and 2), then the Project drawer, then the What's next panel (needs the ranking extracted first), then the first-run recommendation text in `next` and setup.

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
- [x] AC-9 (owner 2026-11-18): every card and Needs-attention row shows its next step with a Copy button; the Move menu appears only where the connector is reachable and never as an error when absent. (delivered; real-app and browser checks open)
- [x] AC-10 (owner 2026-11-18): the Project button opens every definition file as a tab, scanned for secrets, withheld with a reason on a match, and off when `board.include_docs` is false. (delivered; real-app and browser checks open)
- [x] AC-11 (owner 2026-11-18): the What's next panel gives the same answer as `/laneconductor:next` from one shared ranking, and first-run text recommends starting with the board. (delivered; real-app and browser checks open)

## Board card actions

The board with card actions is the plugin's user interface. The files stay the source of truth; the board is how a person sees and drives them: see every track by lane, see the next step on each card, copy the command, and where the desktop app allows it move a card.

Owner decision 2026-11-18: do both steps. Step 1: every board card and every Needs-attention row shows its next step (a short label with the exact command) and a copy button. Step 2: a Move menu on each card that works only where the page can reach the local connector (Claude desktop app) and otherwise is not shown. Running work (dispatching a runner) is never a page action: only copy the command.

- REQ-7 (step 1, works everywhere, no capability): at generation time, from the track's own markers only (the track row, the dependency state, the stale-claim check) and the project's workflow, every live track gets an action `{c, w}` (the exact command, one short reason) in the board data (`action` in the board, `x` in the page's board.json). The next lane comes from the shared transition resolver (`conductor/services/workflow-transitions.mjs`); lane names are the project's own. No title, Problem or Summary text reaches it. The page shows it on each card, in each Needs-attention row and in the drawer header, with a Copy button that writes to the clipboard inside the click handler, falls back to selecting the text when the write is refused, and says "Copied".
- REQ-8 (step 2, desktop app only): the page draws a Move menu on a card and in the drawer only when `await claude.use('mcp')` resolves non-null. The local connector is probed on the first click (never on load); if it is not reachable the menu is removed with a quiet inline note, never an error banner. A move is `get_track` (for `base`) then `update_track` with markers `{Lane, 'Lane Status': 'queue'}`; the connector's own checks stay authoritative. CONFLICT shows "changed since you looked; refresh the board and try again". Every move has a confirm step in the page; leaving the done lane also needs an explicit tick and passes `reopen: true`. After a write the card moves on screen with the note "the board is a snapshot, ask Claude to refresh it".
- Capability declaration (read from the artifact capability documentation, `mcp`, version 0.2.96): a server on the viewer's device is named `host:<name>`, the local server's name with anything outside `[A-Za-z0-9_-]` replaced by `_`. For this connector (plugin `laneconductor-parallel`, server key `lc`) that is `host:plugin_laneconductor-parallel_lc`, UNVERIFIED in a real desktop app. The page declares `capabilities.mcp` with the entry `{server: "host:plugin_laneconductor-parallel_lc", tools: ["get_track", "update_track"]}`. The page works with the capability absent.

Acceptance for this section is AC-9 above (the Move menu part stays UNVERIFIED until run in a real desktop app and a browser tab).
