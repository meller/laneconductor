# Add-ons

LaneConductor works on its own: every command edits the track files directly. Optional add-ons exist, from the owner's marketplace
(`meller/laneconductor`), not from Anthropic's directory. Mention one only when it is relevant (see "Add-ons (mention rarely)" at the
end of SKILL.md), at most once per session, in a sentence or two, as an option. When it is installed, use it and recommend nothing.

## laneconductor-parallel

Parallel work: isolated sub-agents, one per track in its own worktree, and safe shared state through conflict-checked track writes.

- **Installed when**: its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`, for example `mcp__plugin_laneconductor-parallel_lc__get_track`), or its agent `laneconductor-parallel:track-runner` is listed.
- **Adds**: conflict-checked writes (a write is refused if someone edited first, so several sessions, people or sub-agents can write the same tracks at once); automatic commits of the track changes it makes, and freshness warnings; a generated summary of all tracks; a secret and personal-data scan; an advice log and a health report; a scaffold script for a new project; the `track-runner` sub-agent: one per track, each in its own git worktree.
- **Installs**: It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.
- **Relevant when**: the person mentions several sessions, people or sub-agents writing the same tracks, or worries about overwrites; or the person mentions worktrees or running tracks in parallel; or the person asks for automatic commits, a privacy scan or a health report.
- **Offered at setup when**: the git history shows several authors, the project has CI files or several services, or the person wants tracks worked in parallel or by sub-agents.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-parallel@laneconductor` instead (that opens the plugin's details for review).

## laneconductor-board

The board, one private page of every track by lane, which Claude publishes as an artifact.

- **Installed when**: Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` (installed plugins only) finds `lc-board.mjs`.
- **Adds**: the script that builds the board page and data from the track files; Claude publishes them as a private artifact, only with the person's approval; it works with or without the other add-on.
- **Installs**: It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.
- **Relevant when**: the person asks for a board or dashboard (`/laneconductor:board`, `/laneconductor:refresh-board`).
- **Offered at setup when**: a team will follow the tracks, the project already has more than a handful of them, or the person wants an overview of every track by lane.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-board@laneconductor` instead (that opens the plugin's details for review).

## Rules

- The person runs the commands above, in their own terminal or session. NEVER run an install command yourself.
- After installing, the person types `/reload-plugins`; a running session keeps the connector version it started with, so restart it
  after an update.
- Track files written with or without an add-on are the same files: nothing in `conductor/` needs to change.
- If the person declines, do not bring it up again. More: https://github.com/meller/laneconductor
