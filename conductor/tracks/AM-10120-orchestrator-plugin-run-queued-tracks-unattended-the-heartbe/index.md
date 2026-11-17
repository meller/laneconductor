# Track AM-10120: Orchestrator plugin: run queued tracks unattended (the heartbeat, without a daemon or database)

**Lane**: backlog
**Lane Status**: queue
**Progress**: 0%
**Phase**: Backlog: parked idea (decided 2026-11-17: not now; build only when there is a real wish to run tracks unattended); after the hooks extension (10115) and the lane-runner skill (10108)
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Depends On**: 10115, 10108
**Problem**: Idea recorded 2026-11-17 (human, thinking out loud): an optional second plugin, the LaneConductor orchestrator or "heartbeat", that picks up tracks marked auto-run and works them without the person present. It is the old sync daemon's job, redone on top of what exists now: no Postgres, no always-on server.

Sketch (to be decided in the plan lane): a scheduled or hook-driven runner (Claude Code scheduled tasks, or a loop) that lists tracks in a runnable lane with auto-run set, starts one track-runner sub-agent per track in its own git worktree, and stops at the human gates (merge, push, deploy, anything outward-facing). It reports through the board and the track's index.md markers. Open questions: permission rules for unattended runs, cost limits per run, how it avoids two runners taking the same track (the connector's conflict-checked writes and a claim marker), what happens when a run stalls, and whether it belongs in the core plugin or as its own add-on (leaning: own add-on, like laneconductor-hooks).

Why parked: nobody has asked for unattended runs yet, they cost money and need safe permission rules, and the positioning decision of 2026-11-17 is plan-first process with a person in the loop, not a ticket-to-pull-request agent. Build it only when there is a real wish to run tracks overnight. Depends on the hooks extension (track 10115) for the trigger mechanism and on the lane-runner skill (track 10108).
**Summary**: Idea recorded 2026-11-17 (human, thinking out loud): an optional second plugin, the LaneConductor orchestrator or "heartbeat", that picks up tracks marked auto-run and works them without the person pr
