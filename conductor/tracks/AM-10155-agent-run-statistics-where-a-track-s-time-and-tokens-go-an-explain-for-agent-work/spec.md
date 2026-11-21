# Spec: agent run statistics (AM-10155)

## Problem Statement
An agent's work on a track is invisible in cost: time, tokens, tool calls. The plan shows what was done, not what it cost. Like an SQL EXPLAIN shows where a query spends its time, a track needs a plan-with-costs, so inefficiency in how we use the code and the tracks data becomes visible and can be fixed.

## Why measure from outside
An agent cannot read a clock or its own token meter, so asking it to write timings into the plan would produce invented numbers. The measurements come from records the tools already keep.

## Sources (read only)
- Session transcripts under the Claude config folder (`projects/<project>/<session>.jsonl`, sub-agent runs included): per-message token counts (output, input, cache creation, cache read), timestamps, tool names and durations, the skill or plugin that was running, the working directory and branch.
- The track files and git: plan.md ticks (commit times), dated lines in history.md, lane claims, commit times.

## Requirements
- REQ-1 A script `lc-explain.mjs` in the board add-on (`node lc-explain.mjs --repo . --track <N>`) prints the statistics and writes `explain.md` into the track folder. It is read-only toward the transcripts and the repository.
- REQ-2 Boundaries: a lane run starts at its claim (the Lane marker change) and ends at its completion line; phases inside implement are bounded by the plan.md tick commits. Transcript messages are attributed to a track by the time window and the working directory or branch, not by reading their content.
- REQ-3 Per lane and per phase: wall-clock split into active time and waiting on a human (a gap above a set number of minutes between an assistant message and the next user message counts as waiting); tokens as output, fresh input, cache creation and cache reads, shown separately (cache reads dominate and cost little); tool calls by kind; the slowest steps; the share done by sub-agents; files read more than once, as a count of repeats (see REQ-4).
- REQ-4 Privacy: only numbers, timestamps and tool names are read or written. No prompt, message or file content, no secret. A test feeds a transcript whose content holds a token and an email and asserts neither reaches the output.
- REQ-5 `explain.md` is generated and overwritten on each run, never edited by hand, and says when it was generated and from which sessions. It is the stored record, because transcripts are local and can be cleaned up.
- REQ-6 The board shows it as an "Agent run" tab next to the track's other documents (overview, plan, spec, tests), with a per-phase table. The board's privacy scan applies to it like any document.
- REQ-7 The first version changes no base plugin text, so there is no new base version for the directory review. A later phase may have the lanes run the script at completion and add a short suffix to the completion line in history.md; that is base text and its own track.
- REQ-8 Use it: run it on finished tracks (10154 first), record what it shows in this spec, and name the biggest inefficiencies. One hypothesis to test: each lane command carries about 27 KB of reference text, so every lane run pays for it before any work starts.
- REQ-9 The post "Pick Your Agent's Brain" (draft under track 10112) uses real output of this script, and every number in it is checked.

## Probe findings (2026-11-21, plan lane, read-only, on this repository's own session transcript in the desktop app)
- Each assistant message carries a usage record: input, output, cache creation and cache read tokens, plus a thinking-token count. Messages carry a timestamp, the working directory and the git branch.
- Sub-agent runs are separate transcripts in `<session>/subagents/agent-<id>.jsonl`, flagged as side chains, with the parent's session id and their own usage records. So their tokens can be added to the parent's window.
- One session file can span months (this one runs from 2026-09-07 to 2026-11-21, across resumes and compactions) and many tracks, so a lane run must be cut out by its time window, never by session.
- A session that works in a worktree shows the worktree path as its working directory and the track branch (for example `.worktrees/10099`); sessions started inside a worktree get their own project folder.
- A tool's duration is rarely recorded: only 62 tool results carried a duration field against about 13,700 assistant messages, so durations must be computed from the timestamps of the call and of its result. That includes any wait for a permission answer, so it is approximate.
- Not yet checked: the same layout in a plain CLI session (the probe was the desktop app); Task 1 of the plan repeats the probe there.

## Decisions (2026-11-21, plan lane; the owner can overrule any of them)
- D1 Done tracks: per-track documents on the board stay for tracks that are not done (unchanged). The finished tracks appear in a project-level "Statistics" tab (a project file generated from every track's `explain.md`) with one row per track and the lane and phase totals, which is also the view that shows what is inefficient overall.
- D2 Dollars: tokens only in the first version. The transcripts carry a session-level cost figure (not checked, and prices change), which cannot be split per phase reliably.
- D3 Attribution: by the time window of the lane run plus the working directory or branch, and each table says it is approximate where one session worked several tracks at once.
- D4 Waiting on a person: a gap of more than 5 minutes between an assistant message and the next user message counts as waiting. The 5 minutes is a starting value in one constant, to be tuned on real tracks.
- D5 Where the script lives: the board add-on (`connector/bin/lc-explain.mjs`, generated into the board plugin), so no base text changes (REQ-7).

## Out of scope
Changing the lane texts, any hook that records timings while the agent works, the database-era run ledger (AM-10100), cost limits or alerts.

## Open questions
- Does a plain CLI session use the same folder layout for sub-agents and the same fields (the probe above was the desktop app)?
- How should a message be attributed when two tracks were worked in the same minutes (a parallel dispatch)? D3 says approximate; check how often it happens before building more.
