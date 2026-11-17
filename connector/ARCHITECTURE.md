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
- **Recipes.** Reusable procedures (track AM-10107), also plain Markdown.
- **Connector logic.** `connector/src/**`: reading and writing track files with base-commit checks, commits,
  push policy, summaries, the board data. The MCP SDK is imported only by `src/server.mjs` and the entry `bin/lc-connector.mjs`.
- **The MCP tool contract.** The eight tools in `connector/src/tools/` (`get_context`, `list_tracks`, `get_track`,
  `create_track`, `update_track`, `append_conversation`, `report_outcome`, `health_report`) and their
  inputs and outputs. Any MCP client can use them.

## (b) The Claude adapter

Everything that maps the core onto Claude Code, Cowork and the Anthropic plugin directory. All of it is
produced by the generator profiles in `scripts/build-plugin.mjs` from sources in `connector/plugin-extras/`
and never edited by hand under `plugins/`:

- the plugin manifests (`plugin.json`), the marketplace entries (`.claude-plugin/marketplace.json`) and the icon;
- the slash commands (`commands/`) and subagents (`agents/`), including their Claude frontmatter;
- the skill frontmatter transforms (for the directory build the `allowed-tools` key is dropped) and the
  Habits section appended to the lean `SKILL.md` because that plugin has no hooks;
- the hooks, when they ship (track AM-10115 Phase 1): shell scripts wired by `hooks/hooks.json`;
- `.mcp.json`, which starts the connector over stdio with Claude's `${CLAUDE_PLUGIN_ROOT}` variable.

Three plugins exist because the directory accepts only Markdown, text, JSON, YAML and a few image types
from a publisher that is not a Verified organization. Each is one adapter of the same core, built by its own
generator profile from the same sources, all in one marketplace:

- `plugins/laneconductor` (lean, directory-eligible): the skill, commands, agents, icon. No program.
- `plugins/laneconductor-board` (local add-on, depends on the lean one): the board generator script and exactly
  the source files it imports. No npm package.
- `plugins/laneconductor-connector` (optional local add-on, depends on the lean one): the MCP server with server
  key `lc` (tools are named `mcp__plugin_laneconductor-connector_lc__<tool>`), its lockfile, and later the hooks
  that match its tool names.

The commands and agents work with or without the connector: they use its tools when present and edit the track
files directly otherwise. Hooks, when they ship, go into an add-on, never into the lean plugin.

## (c) What another agent would need

A new agent gets an adapter, not a rewrite:

1. A generator profile that maps the commands and lane guides onto that agent's own extension mechanism
   (custom prompts, rules files, instruction folders, whatever it has), reading the same sources.
2. A way to start `connector/bin/lc-connector.mjs` over stdio (the MCP server is reusable as is), or none: the
   core also works by editing the track files directly.
3. Its own equivalent of hooks, if it has one, written in that adapter.

No adapter for another agent exists yet; this note only fixes where it would go.

## The rule

Claude-specific behaviour never leaks into (a). Tool-name prefixes such as `mcp__plugin_laneconductor-connector_lc__...`,
frontmatter keys, `${CLAUDE_PLUGIN_ROOT}`, plugin names and directory rules belong to (b) and only to (b). If a
guide or a connector change needs one of them, put it in a generator transform or in a file under
`connector/plugin-extras/`, and keep the neutral source text agent-neutral.
