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
- the slash commands (`commands/`), generated from the neutral command catalog (Claude frontmatter, the sub-agent names, the Artifact tool and the fallback line for an unavailable connector are added by the generator), and the subagents (`agents/`, from `connector/plugin-extras/agents/`);
- the skill frontmatter transforms (the `allowed-tools` key is dropped in both profiles) and the Habits section appended
  to `SKILL.md` because no hooks ship in the main plugin;
- `.mcp.json`, which starts the connector over stdio with Claude's `${CLAUDE_PLUGIN_ROOT}` variable.

There is ONE plugin, `laneconductor`, installed locally from the owner's marketplace or by uploading a zip (decision of
2026-11-17: the connector is the main LaneConductor). It is built by the generator in two profiles from the same sources:

- `full` (the default build, `plugins/laneconductor`, the one we ship): the skill, commands, agents, the MCP server with
  server key `lc` (tools are named `mcp__plugin_laneconductor_lc__<tool>`), the board script and page, the lockfile and the
  icon.
- `lean` (built on demand with `--profile lean --out <dir>`, not in the marketplace): Markdown, JSON and one PNG only; kept
  ready and tested. Anthropic's directory rules as read on 2026-11-17 allow a local MCP server inside a plugin bundle (the
  lockfile install and the local server are held for a reviewer), so the full plugin is the one to submit and the lean
  profile is only a fallback if the portal blocks it.

The commands and agents use the connector's tools and fall back to editing the track files directly when the MCP server
fails to start. Hooks will not go into the main plugin: they will be a separate, opt-in extension, `laneconductor-hooks`
(`dependencies: ["laneconductor"]`, scripts only), not yet available, because hooks run on every session and tool call
and must be removable by uninstalling them.

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
