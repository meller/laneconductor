---
description: Review a track's implementation (recommends one sub-agent per track in its own worktree)
argument-hint: <track number or title>
---
Review track `$ARGUMENTS`. The procedure is the review lane guide (skill file `lanes/review.md`); follow it and do not restate it here.

1. Call `get_context` with lane `review` and `get_track` for the track.
2. RECOMMEND, do not start: suggest one sub-agent per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding.
3. Show the exact dispatch you would make, with this prompt: "Review track N in the review lane: read the lane guide, evaluate the work, do not fix it, report a verdict with evidence; do not merge or push."
4. Start nothing until I say yes. If I decline, or sub-agents are unavailable (chat), do the lane yourself in this session following the guide.
5. Record state with `update_track` and the `base` from `get_track`.

In Claude Code the sub-agent is `laneconductor:track-runner`, one per track, each in its own worktree. See "Plugin users" in the skill's `ops/working-a-track.md`.

Use the connector's tools (`mcp__plugin_laneconductor_lc__*`) when they are present. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
