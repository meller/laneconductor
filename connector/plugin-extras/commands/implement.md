---
description: Implement a track from its plan (recommends one track-runner subagent in its own worktree)
argument-hint: <track number or title>
---
Implement track `$ARGUMENTS`. The procedure is the laneconductor skill's `lanes/implement.md`; follow it and do not restate it here.

1. With the `laneconductor-connector` plugin its tools (`mcp__plugin_laneconductor-connector_lc__*`) are available: use them, as the steps say. Call `get_context` with lane `implement` and `get_track` for the track. Without the connector, do the same by editing the track files directly, following the skill (`ops/tracks.md` has the formats): re-read a file right before editing it and change only the lines you mean to change.
2. RECOMMEND, do not start: suggest the `laneconductor:track-runner` subagent, one per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding. See "Plugin users" in the skill's `ops/working-a-track.md`.
3. Show the exact dispatch you would make: agent `laneconductor:track-runner`, prompt "Work track N through its implement lane: read the lane guide, follow plan.md, commit in your worktree, report commits and test results; do not merge or push."
4. Start nothing until I say yes. If I decline, or agents are unavailable (chat), do the lane yourself in this session following `lanes/implement.md`.
5. Record state with `update_track` and the `base` from `get_track`, or, without the connector, by editing only the marker lines of `index.md`.
