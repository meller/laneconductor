---
description: Take a track through its lanes (recommends one sub-agent per track, in its own worktree)
argument-hint: <track number or title>
---
Run track `$ARGUMENTS` end to end. The guardrails are the skill file `ops/working-a-track.md`; read it, and read the lane guide for each lane you run.

1. Call `get_track` for the track (`list_tracks` first if I gave a title) and `get_context` for the lane it is in; `get_context` also lists where each lane goes next.
2. RECOMMEND, do not start: suggest one sub-agent per track, each in its own worktree. Why: isolation from the primary checkout, several tracks in parallel, no collisions.
3. Show the exact dispatch you would make, with this prompt: "Work track N through its <current lane> lane: read the lane guide, do the work, commit in your worktree, report commits and test results; do not merge or push." One dispatch per lane, one agent per track.
4. Start nothing until I say yes. If I decline, or sub-agents are unavailable (chat), work the lane in this session following its lane guide.
5. Record state with `update_track` and the `base` from `get_track`. Ask me before any merge or push.
6. If I ask for the board along the way: building it needs the `lc` command-line tool or the board script; if neither exists, say so and stop that step.

In Claude Code the sub-agent is `laneconductor:track-runner`, one per track, each in its own worktree. See "Plugin users" in the skill's `ops/working-a-track.md`.

Generating the board needs the plugin's own board script or the `lc` command on PATH. The script is `server/bin/lc-board.mjs` in this plugin: find it with Glob `**/laneconductor/**/server/bin/lc-board.mjs` under `~/.claude/plugins` (the `${CLAUDE_PLUGIN_ROOT}` variable may not be substituted in command text) and run `node <that path> --repo . --site "$site" --json`, or use `lc board --site "$site" --json` when `lc` is on PATH. If neither exists, say so plainly and stop; do not try to build the page by hand.

Use the connector's tools (`mcp__plugin_laneconductor_lc__*`) when they are present. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
