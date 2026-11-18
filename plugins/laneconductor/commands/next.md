---
description: Name the one next step for this project and explain it (read only)
argument-hint: "[explain | short | track number]"
---
What's next: `$ARGUMENTS` (nothing given means the whole project). Read only: change no file and no marker, install nothing and push nothing. The procedure is the skill file `ops/next.md`; read it in full first and follow it.

1. Gather where the project stands as the file says, with Glob, Grep, Read and read-only git (`git branch --list`, `git merge-base --is-ancestor`, `git log`); nothing else.
2. Name exactly one next step with the exact command to type, one sentence on what it does and one on why it comes next, the other candidates in one line, and the link to the reference. `explain` adds the primer, `short` gives one line, a track number limits the answer to that track.
3. Ask before writing anything (the only write is a saved level, only if I ask for it). Run the step only if I say go.

In Claude Code, type it as `/laneconductor:next`; the commands in the card are written in that form.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__list_tracks`, `mcp__plugin_laneconductor-parallel_lc__get_track`), use them to read: they report how fresh the state is. This command writes nothing. If they are not present, the steps above are the whole job.
