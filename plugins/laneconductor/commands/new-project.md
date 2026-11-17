---
description: "Start a project: a short interview, recipe recommendations, the conductor scaffold and the first tracks (runs only because you named it)"
argument-hint: "[name or idea]"
---
New project: `$ARGUMENTS` (nothing given means ask me). This runs only because I named it. The procedure is the skill file `ops/new-project.md`; read it in full first and follow it.

1. Detect whether this is an empty folder or an existing repository (then offer only the `conductor/` scaffold).
2. Interview me in chat, one question at a time, short, stopping early when the answers are enough.
3. Recommend up to five recipes with a reason and a date each; I choose, and nothing is applied silently. If there are no recipes, say so and continue.
4. Show what the scaffold will create and ask before writing it, then create the first tracks in the plan lane.
5. Summarize, then ask before any commit. Never push.

Use the connector's tools (`mcp__plugin_laneconductor_lc__*`) when they are present. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
