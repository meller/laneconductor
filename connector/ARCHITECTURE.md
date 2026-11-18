# Architecture: a neutral core and a Claude adapter

LaneConductor is built in layers so that its value does not depend on one agent. Everything that is specific
to Claude's plugin system lives in one place (the adapter); the rest knows nothing about it.

## (a) The neutral core

This is the product. It has no Claude-only assumption and must keep none.

- **Track files in git.** `conductor/tracks/<ID>/` with `index.md` (state markers), `spec.md`, `plan.md`,
  `test.md` and `conversation.md`; `conductor/workflow.json` for lanes. The formats are plain text.
- **Lane guides and ops docs.** `.claude/skills/laneconductor/lanes/*.md` and `ops/*.md`: advice for each lane
  and for track operations, written as instructions any capable agent can follow. (The folder name and the
  `SKILL.md` index are the source skill's layout, not a requirement of the content.)
- **Connector logic.** `connector/src/**`: reading and writing track files with base-commit checks, commits,
  push policy, summaries, the board data. The MCP SDK is imported only by `src/server.mjs` and the entry `bin/lc-connector.mjs`.
- **The MCP tool contract.** The tools in `connector/src/tools/` (`get_context`, `list_tracks`, `get_track`,
  `create_track`, `update_track`, `append_conversation`, `report_outcome`, `health_report`, and the read-only
  `help`) and their inputs and outputs. Any MCP client can use them.
- **The command catalog.** `connector/src/commands.mjs` (track AM-10116) is the single, agent-neutral source of every
  command: name, description, arguments, example phrase and a short procedure that names the lane guides and the
  connector tools by their plain names. Two adapters read it: the stdio server registers each entry as an MCP prompt
  (plus a `help` prompt and tool; the pattern is FITI's), and the plugin generator writes the Claude Code
  `commands/*.md` from it. The catalog names no Claude tool prefix, plugin path or sub-agent.

## (b) The Claude adapter

Everything that maps the core onto Claude Code, Cowork and the Anthropic plugin directory. All of it is
produced by the generator profiles in `scripts/build-plugin.mjs` from sources in `connector/plugin-extras/`
and never edited by hand under `plugins/`:

- the plugin manifests (`plugin.json`), the marketplace entries (`.claude-plugin/marketplace.json`) and the icon;
- the slash commands of the base (`commands/`), generated from the neutral command catalog (Claude frontmatter, the sub-agent names, the Artifact tool, the board-script lookup and the one line naming the add-on's tools are added by the generator), and the subagents (`agents/`, from `connector/plugin-extras/agents/`);
- the skill frontmatter transforms (the `allowed-tools` key is dropped) and the Habits and Add-ons sections appended
  to `SKILL.md` because no hooks ship;
- `.mcp.json` of the parallel add-on, which starts the connector over stdio with Claude's `${CLAUDE_PLUGIN_ROOT}` variable.

There are THREE plugins, built by the generator from the same sources (decision of 2026-11-18, track AM-10128: the directory portal blocks
the all-in-one plugin for an organization that is not Verified, so only a Markdown-only plugin can be submitted):

- `laneconductor`, the BASE (`plugins/laneconductor`, profile `base`, the plugin submitted to the directory): Markdown, JSON and one PNG
  only. The skill, every slash command, the read-only `plan-reviewer` subagent, README, `ADD-ONS.md`, LICENSE, icon and a manifest of
  fields the portal knows. No program, no `.mcp.json`, no package files, no `isolation` key. It works alone, by editing the track files.
- `laneconductor-parallel` (add-on, our marketplace only, profile `parallel`): the connector (MCP server key `lc`), the scaffold script,
  `package.json` and lockfile at the root, and the `track-runner` subagent with `isolation: worktree`.
- `laneconductor-board` (add-on, our marketplace only, profile `board`): the board script and its page. It works without the connector.

All slash commands live in the base (a plugin's slash prefix is its plugin name, so add-on commands would split what people type); the
add-ons ship no `commands/` or `skills/`, and reach people through the base commands, the connector's MCP prompts and agents.

THE INTERFACE between the plugins (no dependency: the base comes from the directory, the add-ons from our marketplace). It is defined once,
in `scripts/plugin-texts.mjs`, and tested in `connector/test/interop.test.mjs`:

| What | Value | Used by |
| :--- | :--- | :--- |
| connector server key | `lc` (`.mcp.json` of the parallel add-on) | tool names |
| connector tool prefix | `mcp__plugin_laneconductor-parallel_lc__<tool>` (Claude Code derives it from plugin name + server key) | the base's commands, Habits and agents name it only `if present` |
| sub-agent | `laneconductor-parallel:track-runner` | the base's `run`, `implement`, `review` recommend it only when it is listed |
| board script | `server/bin/lc-board.mjs` in the board add-on, found by Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` (installed versions only, not the marketplaces/ clone) | the base's `board`, `refresh-board`, `ops/board.md` |
| scaffold script | `server/bin/lc-scaffold.mjs` in the parallel add-on, found by Glob `**/laneconductor-parallel/**/server/bin/lc-scaffold.mjs` | `ops/new-project.md` (by hand when absent) |
| versions | all three start at 1.0.0 and follow `connector/package.json` | `plugin.json` |

DETECTION: Claude sees which tools, agents and files exist. When the connector tools or the board script are present the base uses them and
recommends nothing; when they are missing the base mentions the add-on once per session, only when the person asks for a board, mentions
several sessions, people or sub-agents writing the same tracks, worktrees, or wants automatic commits, a privacy scan or a health report;
it shows the install commands (one per bash block; the person runs them) and never runs an install itself. The directory policy bans
listings that exist mainly as advertising, so the base is useful alone and the pointers are short. The text is written once (the
`BASE_HABITS` funnel paragraph and `ADD_ONS_MD` in `scripts/plugin-texts.mjs`).

The commands and agents of the add-ons use the connector's tools; the base's fall back to editing the track files directly. Hooks will not
go into any of them: they will be a separate, opt-in extension, `laneconductor-hooks` (scripts only), not yet available, because hooks
run on every session and tool call and must be removable by uninstalling them.

## (c) What another agent would need

A new agent gets an adapter, not a rewrite:

1. A generator profile that maps the commands and lane guides onto that agent's own extension mechanism
   (custom prompts, rules files, instruction folders, whatever it has), reading the same sources.
2. A way to start `connector/bin/lc-connector.mjs` over stdio (the MCP server is reusable as is), or none: the
   core also works by editing the track files directly.
3. Its own equivalent of hooks, if it has one, written in that adapter.

No adapter for another agent exists yet; this note only fixes where it would go.

## The rule

Claude-specific behaviour never leaks into (a). Tool-name prefixes such as `mcp__plugin_laneconductor_lc__...`,
frontmatter keys, `${CLAUDE_PLUGIN_ROOT}`, plugin names and directory rules belong to (b) and only to (b). If a
guide or a connector change needs one of them, put it in a generator transform or in a file under
`connector/plugin-extras/`, and keep the neutral source text agent-neutral.
