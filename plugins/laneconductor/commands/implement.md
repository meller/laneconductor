---
description: Implement a track from its plan (recommends one sub-agent per track in its own worktree)
argument-hint: <track number or title>
---
Implement track `$ARGUMENTS`. The procedure is the implement lane guide (skill file `lanes/implement.md`); follow it and do not restate it here.

1. Call `get_context` with lane `implement` and `get_track` for the track.
2. RECOMMEND, do not start: suggest one sub-agent per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding.
3. Show the exact dispatch you would make, with this prompt: "Work track N through its implement lane: read the lane guide, follow plan.md, commit in your worktree, report commits and test results; do not merge or push."
4. Start nothing until I say yes. If I decline, or sub-agents are unavailable (chat), do the lane yourself in this session following the guide.
5. Record state with `update_track` and the `base` from `get_track`.

In Claude Code the sub-agent is `laneconductor:track-runner`, one per track, each in its own worktree. See "Plugin users" in the skill's `ops/working-a-track.md`.

Use the connector's tools (`mcp__plugin_laneconductor_lc__*`) when they are present. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
