---
description: "Plan a track: write its spec, plan and test cases (the plan lane)"
argument-hint: <track number or title>
---
Work on track `$ARGUMENTS` in the plan lane. The procedure is the plan lane guide (skill file `lanes/plan.md`); follow it and do not restate it here.

1. Call `get_context` with lane `plan`: it returns the guide, as advice. Then call `get_track` for the track (`list_tracks` first if I gave a title). Change state only with `update_track`, passing the `base` from `get_track`; on a CONFLICT, re-read and retry.
2. Work through the guide.

Use the connector's tools (`mcp__plugin_laneconductor_lc__*`) when they are present. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
