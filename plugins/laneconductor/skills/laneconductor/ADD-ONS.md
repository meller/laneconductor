# Add-ons: parallel work and the board

LaneConductor works on its own: every command edits the track files directly. Two optional add-ons exist, from the owner's marketplace
(`meller/laneconductor`), not from Anthropic's directory. Mention one only when it is relevant (see "Add-ons (mention rarely)" at the
end of SKILL.md), at most once per session, in a sentence or two, as an option. When it is installed, use it and recommend nothing.

## laneconductor-parallel: parallel work in worktrees, safe shared writes

- **Installed when**: the tools `mcp__plugin_laneconductor-parallel_lc__*` exist (for example `mcp__plugin_laneconductor-parallel_lc__get_track`), or the agent `laneconductor-parallel:track-runner` is listed.
- **Adds**: conflict-checked writes (a write is refused if someone edited first, so several sessions, people or sub-agents can write the
  same tracks at once), automatic commits of the track changes it makes, freshness warnings, a generated summary of all tracks, a secret
  and personal-data scan, an advice log and a health report, a scaffold script for a new project, and the `track-runner` sub-agent: one
  per track, each in its own git worktree.
- **Costs**: it runs a local Node.js program (the connector).
- **Relevant when**: the person mentions several sessions, people or sub-agents writing the same tracks, worktrees, parallel tracks,
  overwrites, automatic commits, a privacy scan or a health report.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-parallel@laneconductor` instead (that opens the plugin's details for review).

## laneconductor-board: the board

- **Installed when**: Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins` finds `lc-board.mjs`.
- **Adds**: the script that builds the board page and data from the track files. Claude publishes them as a private artifact, only with
  the person's approval. It works with or without the other add-on.
- **Relevant when**: the person asks for a board or dashboard (`/laneconductor:board`, `:refresh-board`).

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
