---
description: Review a track's spec and plan for gaps with a read-only reviewer
argument-hint: <track number or title>
---
Review the plan of track `$ARGUMENTS`. Read only; change no file and no marker.

1. Hand the review to a read-only sub-agent with the prompt "Review the spec and plan of track N and report gaps, missing tests, unclear tasks and risks." It reads the track files and returns advice.
2. Show me its answer as it is. Where sub-agents are unavailable (chat), read `spec.md` and `plan.md` of the track yourself and give the same four headings: gaps, missing tests, unclear tasks, risks.

Dispatch the `laneconductor-lite:plan-reviewer` subagent (read only) with that prompt.
