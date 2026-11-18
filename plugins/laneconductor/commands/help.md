---
description: List every LaneConductor command with an example phrase
---
Show me this list as it is; run nothing else.

LaneConductor commands. Say one in your own words, or use it as a slash command.

Plan and deliver
- plan <track number or title>: Plan a track: write its spec, plan and test cases (the plan lane). Example: "plan track 10106"
- brainstorm <track number or title>: Brainstorm a track: explore options and decisions before planning. Example: "brainstorm the export feature"
- implement <track number or title>: Implement a track from its plan (recommends one sub-agent per track in its own worktree). Example: "implement track 10106"
- review <track number or title>: Review a track's implementation (recommends one sub-agent per track in its own worktree). Example: "review track 10106"
- quality-gate <track number or title>: Run the quality gate on a track (evaluates, never fixes). Example: "run the quality gate on 10106"
- merge <track number or title>: Merge a finished track, or open its PR. Example: "merge track 10106"
- run <track number or title>: Take a track through its lanes (recommends one sub-agent per track, in its own worktree). Example: "run track 10106 end to end"
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
- help: List every LaneConductor command with an example phrase. Example: "what can LaneConductor do"

Board
- board [show | update]: Show or refresh the project board (asks which when unclear). Example: "show the board"
- show-board: Open the existing board and give its link (never regenerates it). Example: "open the board"
- refresh-board: Rebuild the board from the track files and republish it to its stored URL. Example: "refresh the board"

Setup and deploy
- new-project [name or idea]: Start a project: a short interview, the conductor scaffold and the first tracks (runs only because you named it). Example: "start a new project: a habit tracker"
- setup [scaffold]: Add LaneConductor to this project: read what is there, confirm the stack and commands, write the conductor/ files (runs only because you named it). Example: "add LaneConductor to this project"
- deploy [setup]: Set up or run deployment for this project (runs only because you named it). Example: "deploy this project"

Works on its own: every command edits the track files directly. Needs the laneconductor-board add-on: board (only to refresh) and refresh-board; without it they say so and show how to get it. With the laneconductor-parallel add-on installed, the commands use its conflict-checked tools and dispatch its track-runner sub-agent.

In Claude Code, type a command as `/laneconductor:<name>`, for example `/laneconductor:plan 10106`; typing `/laneconductor:` lists them all.
