---
description: Review a track's spec and plan for gaps with the read-only plan-reviewer subagent
argument-hint: <track number or title>
---
Review the plan of track `$ARGUMENTS`. Read only; change no file and no marker.

1. Dispatch the `laneconductor:plan-reviewer` subagent with the prompt "Review the spec and plan of track N and report gaps, missing tests, unclear tasks and risks." It reads the track files and returns advice.
2. Show me its answer as it is. Where agents are unavailable (chat), read `spec.md` and `plan.md` yourself and give the same four headings.
