---
description: Take a track through its lanes (recommends one track-runner subagent per track, in its own worktree)
argument-hint: <track number or title>
---
Run track `$ARGUMENTS` end to end. The guardrails are the laneconductor skill's `ops/working-a-track.md`; read it, and read the lane file for each lane you run.

1. Call `get_track` for the track (`list_tracks` first if I gave a title) and `get_context` for the lane it is in; read `conductor/workflow.json` for where each lane goes next.
2. RECOMMEND, do not start: suggest the `laneconductor:track-runner` subagent, one per track, each in its own worktree. Why: isolation from the primary checkout, several tracks in parallel, no collisions.
3. Show the exact dispatch you would make: agent `laneconductor:track-runner`, prompt "Work track N through its <current lane> lane: read the lane guide, do the work, commit in your worktree, report commits and test results; do not merge or push." One dispatch per lane, one agent per track.
4. Start nothing until I say yes. If I decline, or agents are unavailable (chat), work the lane in this session following its lane file.
5. Change track state only with the connector's `update_track`, passing the `base` from `get_track`; never hand-edit index.md markers when the connector is available. Ask me before any merge or push.
