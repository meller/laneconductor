---
description: Implement a track from its plan (recommends one track-runner subagent in its own worktree)
argument-hint: <track number or title>
---
Implement track `$ARGUMENTS`. The procedure is the laneconductor skill's `lanes/implement.md`; follow it and do not restate it here.

1. Call the connector's `get_context` with lane `implement`, then `get_track` for the track.
2. RECOMMEND, do not start: suggest the `laneconductor:track-runner` subagent, one per track, each in its own worktree, because that isolates code changes from the primary checkout, lets several tracks run in parallel, and keeps them from colliding. See "Plugin users" in the skill's `ops/working-a-track.md`.
3. Show the exact dispatch you would make: agent `laneconductor:track-runner`, prompt "Work track N through its implement lane: read the lane guide, follow plan.md, commit in your worktree, report commits and test results; do not merge or push."
4. Start nothing until I say yes. If I decline, or agents are unavailable (chat), do the lane yourself in this session following `lanes/implement.md`.
5. Change track state only with the connector's `update_track`, passing the `base` from `get_track`; never hand-edit index.md markers when the connector is available.
