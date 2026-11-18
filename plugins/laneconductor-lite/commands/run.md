---
description: Take a track through its lanes (recommends one sub-agent per track, in its own worktree)
argument-hint: <track number or title>
---
Run track `$ARGUMENTS` end to end. The guardrails are the skill file `ops/working-a-track.md`; read it, and read the lane guide for each lane you run.

1. Find the track's folder under `conductor/tracks/` (Glob `conductor/tracks/*<number>*/`; both naming conventions exist, see "Finding a track" in the skill index) and read its `index.md`, `spec.md`, `plan.md`, `test.md` and `conversation.md`. Read `conductor/workflow.json` too: it says where each lane goes next.
2. RECOMMEND, do not start: suggest one sub-agent per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding.
3. Show the exact dispatch you would make, with this prompt: "Work track N through its <current lane> lane: read the lane guide, do the work, commit in your worktree, report commits and test results; do not merge or push." One dispatch per lane, one agent per track.
4. Start nothing until I say yes. If I decline, or sub-agents are unavailable (chat), work the lane in this session following its lane guide.
5. Change state by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change. Ask me before any merge or push.

In Claude Code the sub-agent is `laneconductor-lite:track-runner`, one per track, each in its own worktree (it creates the worktree itself). See "Plugin users" in the skill's `ops/working-a-track.md`.
