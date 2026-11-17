---
description: Review a track's implementation (recommends one track-runner subagent in its own worktree)
argument-hint: <track number or title>
---
Review track `$ARGUMENTS`. The procedure is the laneconductor skill's `lanes/review.md`; follow it and do not restate it here.

1. Call the connector's `get_context` with lane `review`, then `get_track` for the track.
2. RECOMMEND, do not start: suggest the `laneconductor:track-runner` subagent, one per track, each in its own worktree, because that isolates the review from the primary checkout, lets several tracks run in parallel, and keeps them from colliding. See "Plugin users" in the skill's `ops/working-a-track.md`.
3. Show the exact dispatch you would make: agent `laneconductor:track-runner`, prompt "Review track N in the review lane: read the lane guide, evaluate the work, do not fix it, report a verdict with evidence; do not merge or push."
4. Start nothing until I say yes. If I decline, or agents are unavailable (chat), review in this session following `lanes/review.md`.
5. Change track state only with the connector's `update_track`, passing the `base` from `get_track`; never hand-edit index.md markers when the connector is available.
