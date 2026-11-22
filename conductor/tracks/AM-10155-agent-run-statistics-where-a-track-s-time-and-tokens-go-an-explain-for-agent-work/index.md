# Track AM-10155: Agent run statistics: where a track's time and tokens go (an explain for agent work)

**Lane**: implement
**Lane Status**: waiting
**Waiting Reason**: Task 31: the owner reads the recommendations of two real tracks and says which are useful; thresholds and wording are then adjusted
**Progress**: 97%
**Phase**: Phase 8 built and pushed 2026-11-22 (board add-on 1.10.17): Recommendations, the per-phase Path and the cross-track view; explain.md of 10146, 10154 and 10155 regenerated. Left: Task 31, the owner reads two real recommendations (HUMAN).
**Track Kind**: feature
**Type**: dev
**Priority**: normal
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Nobody can see what an agent spends on a track: how long each lane and phase took, how many tokens, which tool calls were slow or repeated. Without it the way we use the tracks data and the lane texts cannot be tuned, and a post about how an agent plans and works has no real numbers. The data already exists in the session transcripts (token counts, timestamps, tool durations, sub-agent runs) and in the track files (plan ticks, dated history lines, commits).
**Summary**: A read-only script joins the transcripts with the track files and prints, per lane and per phase, wall-clock split into active and waiting on a human, tokens split into output, fresh input and cache, tool calls by kind and the slowest steps. It writes a generated `explain.md` into the track and the board shows it as an "Agent run" tab next to the plan and tests. No base plugin text changes in the first version. Related: AM-10100 (an older, database-era run ledger for the worker tier; different data source, not extended here) and AM-10112 (the posts program, which carries the post "Pick Your Agent's Brain").
