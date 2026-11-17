---
description: Plan a track: write its spec, plan and test cases (the plan lane)
argument-hint: <track number or title>
---
Work on track `$ARGUMENTS` in the plan lane. The procedure is the laneconductor skill's `lanes/plan.md`; follow it and do not restate it here.

1. With the `laneconductor-connector` plugin its tools (`mcp__plugin_laneconductor-connector_lc__*`) are available: use them, as the steps say. Call `get_context` with lane `plan`, then `get_track` for the track (`list_tracks` first if I gave a title). Change state only with `update_track`, passing the `base` from `get_track`; on a CONFLICT, re-read and retry.
2. Without the connector, do the same by editing the track files directly, following the skill (`ops/tracks.md` has the formats): re-read a file right before editing it and change only the lines you mean to change.
3. Read `lanes/plan.md` in the skill and work through it.
