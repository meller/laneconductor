# LaneConductor Connector

`laneconductor-connector` is the optional safe-writes connector for the [LaneConductor plugin](https://github.com/meller/laneconductor).
In one sentence, it adds conflict-checked writes, automatic commits and freshness warnings for a project's track files
(`conductor/tracks/`), as a local MCP server. It is optional: without it, Claude edits the track files directly,
following the skill. It depends on the `laneconductor` plugin, which supplies the skill, the commands and the subagents;
Claude Code installs both together. A remote connector, for claude.ai and Cowork, may come later as a separate listing.

Version {{VERSION}}.

## Install

In Claude Code: `/plugin marketplace add meller/laneconductor`, then `/plugin install laneconductor-connector@laneconductor`
(the command-line form is `claude plugin install laneconductor-connector@laneconductor`). It needs Node.js 20 or newer and
installs its two npm packages (`@modelcontextprotocol/server`, `zod`) from the lockfile in this plugin. It is not in
Anthropic's directory: the directory accepts only Markdown, text, JSON, YAML and a few image types from a publisher
that is not a verified organization, and this add-on runs a local program. `/mcp` shows it as
`plugin:laneconductor-connector:lc`, and its tools are named `mcp__plugin_laneconductor-connector_lc__<tool>`.

Migration: the old single `laneconductor` plugin included the connector and the board script. That plugin is now the
lean main plugin, so after updating it, install `laneconductor-connector` to keep safe writes and `laneconductor-board`
for the dashboard.

## What it runs

- The connector is a Node process started over stdio by Claude Code (`node server/bin/lc-connector.mjs`).
  It works on the git repository of the project you have open (`CLAUDE_PROJECT_DIR`, else the current
  directory, or an explicit `--repo`).
- It runs `git` in that repository: read-only queries (status, log, rev-parse, rev-list, config), `add`,
  `commit` and `reset` for its own writes, and `push` only in the case described below.
- It reads and writes files under `conductor/` (track folders, `tracks-summary.md`) and appends to
  `conductor/advice-log/`. Every write is a commit on the project's state branch (`main` by default) that
  contains exactly the files it wrote.
- It starts no other programs and makes no network requests of its own. It never pushes unless you set
  `{ "connector": { "push": "auto-state" } }` in `.laneconductor.json`; then it runs a fast-forward
  `git push` of the state branch, 60 seconds after its last write, and only when every unpushed commit
  touches nothing outside `conductor/`. It never forces a push and never runs `git fetch`.
- Eight tools: `get_context`, `list_tracks`, `get_track`, `create_track`, `update_track`, `append_conversation`,
  `report_outcome` and `health_report`. Every answer says which commit it reflects and warns when that may be stale.

## What leaves your machine

Nothing, from this plugin. The connector sends no data anywhere. The advice log it keeps in your repository
records tool names, success flags, timings, sizes and error codes, plus the one-line reason Claude gives when
it deviates from advice; it holds no file contents or prompts. It is an ordinary file in your repository: it
goes to your git remote only if you or the `auto-state` setting push it.

## Safety

- Writes need the `base` you got from your last read; if someone edited the file since, the write is
  refused with a `CONFLICT` and Claude re-reads and merges.
- Writes are refused unless the checkout is on the state branch, so code branches never carry track state.
- Commits touch only the paths written, so unrelated staged or dirty files are never swept in.
- It never force-pushes, and by default never pushes at all.

Hooks that match this connector's tool names are planned and will be listed here when they ship.

## Where it works

The connector runs in Claude Code and Cowork on your own computer. It does not run in claude.ai chat or on
mobile, because it needs a local git checkout.

## License and support

Elastic License 2.0; see [LICENSE](LICENSE). Questions and bugs: https://github.com/meller/laneconductor/issues
