---
description: List every LaneConductor command with an example phrase
---
Show me this list as it is; run nothing else.

LaneConductor commands. Say one in your own words, or use it as a slash command.
Not sure where to go? Use `next`: it reads this project and names the one step.

Start here
- next [explain | short | track number]: Name the one next step for this project and explain it (read only). Example: "what's next"
- suggest-skills [all | dry-run | lane]: What could help with this track: skills you already have that apply, and ones worth installing. Example: "what skills help with this track"
- help: List every LaneConductor command with an example phrase. Example: "what can LaneConductor do"

Plan and deliver
- plan <track number or title>: Plan a track: write its spec, plan and test cases (the plan lane). Example: "plan track 10106"
- brainstorm <track number or title>: Brainstorm a track: explore options and decisions before planning. Example: "brainstorm the export feature"
- implement <track number or title>: Implement a track from its plan (code tracks: one sub-agent in its own worktree). Example: "implement track 10106"
- review <track number or title>: Review a track's implementation (code tracks: one sub-agent in its own worktree). Example: "review track 10106"
- quality-gate <track number or title>: Run the quality gate on a track (evaluates, never fixes). Example: "run the quality gate on 10106"
- merge <track number or title>: Merge a finished track, or open its PR. Example: "merge track 10106"
- run <track number or title>: Take a track through its lanes (code tracks: one sub-agent per track, in its own worktree). Example: "run track 10106 end to end"
- review-plan <track number or title>: Review a track's spec and plan for gaps with a read-only reviewer. Example: "review the plan of track 10106"

Create and manage
- new <title: what and why>: Create a new track from a title and a problem statement. Example: "new track: export the report as CSV"
- bug <what is broken, and how to reproduce it>: File a bug as a track (a bug form with a regression-test case). Example: "flag a bug: the export button does nothing"
- feature <the feature and why it is wanted>: File a feature request as a track (a feature form). Example: "feature request: let me export the report as CSV"
- status [track number]: Show where one track, or all tracks, stand. Example: "status of 10106"
- move <track number> <lane[:status]>: Move a track to another lane, or set its status markers. Example: "move 10106 to implement"
- comment <track number> <comment text>: Add a comment to a track's conversation. Example: "comment on 10106: ship it after the review"
- repair-duplicates: Find tracks that share a number and renumber the newer folder (asks first). Example: "repair duplicate track numbers"
- workflow [lane key value]: Show the lane workflow, or change one lane setting. Example: "show the workflow"

Board
- board [refresh]: Open the project board, or refresh it with the argument refresh. Example: "open the board"
- explain [track number | statistics]: Explain where an agent run's time and tokens went for one track, or give a project summary of the tracks already explained (the argument statistics), like an SQL EXPLAIN. Example: "explain track 10106"

Setup and deploy
- new-project [name or idea]: Start a project: a short brainstorm, the conductor scaffold and the first tracks (runs when you name it, or reply go to a next card). Example: "start a new project: a habit tracker"
- setup [scaffold]: Add LaneConductor to this project: read what is there, write the conductor/ files and file the plan as tracks (runs when you name it, or reply go to a next card). Example: "add LaneConductor to this project"
- deploy [status | history | rollback | setup]: Set up, run, check or roll back deployment for this project (runs only because you named it). Example: "deploy this project"

Works on its own: every command edits the track files directly. Needs the laneconductor-board add-on: board (only to refresh), explain; without it it says so and shows how to get it. With the laneconductor-parallel add-on installed, the commands use its conflict-checked tools and dispatch its track-runner sub-agent.

In Claude Code, type a command as `/laneconductor:<name>`, for example `/laneconductor:plan 10106`; typing `/laneconductor:` lists them all.
