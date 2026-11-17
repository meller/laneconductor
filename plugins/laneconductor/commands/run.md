---
description: Take a track through its lanes (recommends one track-runner subagent per track, in its own worktree)
argument-hint: <track number or title>
---
Run track `$ARGUMENTS` end to end. The guardrails are the laneconductor skill's `ops/working-a-track.md`; read it, and read the lane file for each lane you run.

1. Use the connector's tools (`mcp__plugin_laneconductor_lc__*`), as the steps say. Call `get_track` for the track (`list_tracks` first if I gave a title) and `get_context` for the lane it is in. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change. Read `conductor/workflow.json` for where each lane goes next.
2. RECOMMEND, do not start: suggest the `laneconductor:track-runner` subagent, one per track, each in its own worktree. Why: isolation from the primary checkout, several tracks in parallel, no collisions.
3. Show the exact dispatch you would make: agent `laneconductor:track-runner`, prompt "Work track N through its <current lane> lane: read the lane guide, do the work, commit in your worktree, report commits and test results; do not merge or push." One dispatch per lane, one agent per track.
4. Start nothing until I say yes. If I decline, or agents are unavailable (chat), work the lane in this session following its lane file.
5. Record state with `update_track` and the `base` from `get_track`, or, if the tools are unavailable, by editing only the marker lines of `index.md`. Ask me before any merge or push.
6. If I ask for the board along the way: generating it needs the plugin's own board script (find `server/bin/lc-board.mjs` with Glob `**/laneconductor/**/server/bin/lc-board.mjs` under `~/.claude/plugins`) or the `lc` command on PATH; if neither exists, say so and stop that step.
