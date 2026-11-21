# Track AM-10155: Agent run statistics: where a track's time and tokens go (an explain for agent work)

**Lane**: implement
**Lane Status**: running
**Progress**: 0%
**Phase**: Implement started 2026-11-21: one track-runner sub-agent works phases 1 to 4 (probe, script, board tab, first use) in its own worktree; the post (phase 5) waits for real output.
**Track Kind**: feature
**Type**: dev
**Priority**: normal
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Nobody can see what an agent spends on a track: how long each lane and phase took, how many tokens, which tool calls were slow or repeated. Without it the way we use the tracks data and the lane texts cannot be tuned, and a post about how an agent plans and works has no real numbers. The data already exists in the session transcripts (token counts, timestamps, tool durations, sub-agent runs) and in the track files (plan ticks, dated history lines, commits).
**Summary**: A read-only script joins the transcripts with the track files and prints, per lane and per phase, wall-clock split into active and waiting on a human, tokens split into output, fresh input and cache, tool calls by kind and the slowest steps. It writes a generated `explain.md` into the track and the board shows it as an "Agent run" tab next to the plan and tests. No base plugin text changes in the first version. Related: AM-10100 (an older, database-era run ledger for the worker tier; different data source, not extended here) and AM-10112 (the posts program, which carries the post "Pick Your Agent's Brain").
