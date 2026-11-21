# Spec: agent run statistics (AM-10155)

## Problem Statement
An agent's work on a track is invisible in cost: time, tokens, tool calls. The plan shows what was done, not what it cost. Like an SQL EXPLAIN shows where a query spends its time, a track needs a plan-with-costs, so inefficiency in how we use the code and the tracks data becomes visible and can be fixed.

## Why measure from outside
An agent cannot read a clock or its own token meter, so asking it to write timings into the plan would produce invented numbers. The measurements come from records the tools already keep.

## Sources (read only)
- Session transcripts under the Claude config folder (, sub-agent runs included): per-message token counts (output, input, cache creation, cache read), timestamps, tool names and durations, the skill or plugin that was running, the working directory and branch.
- The track files and git: plan.md ticks (commit times), dated lines in history.md, lane claims, commit times.

## Requirements
- REQ-1 A script  in the board add-on () prints the statistics and writes  into the track folder. It is read-only toward the transcripts and the repository.
- REQ-2 Boundaries: a lane run starts at its claim (the Lane marker change) and ends at its completion line; phases inside implement are bounded by the plan.md tick commits. Transcript messages are attributed to a track by the time window and the working directory or branch, not by reading their content.
- REQ-3 Per lane and per phase: wall-clock split into active time and waiting on a human (a gap above a set number of minutes between an assistant message and the next user message counts as waiting); tokens as output, fresh input, cache creation and cache reads, shown separately (cache reads dominate and cost little); tool calls by kind; the slowest steps; the share done by sub-agents; files read more than once (a count, with the path shown only as a count of repeats, see REQ-4).
- REQ-4 Privacy: only numbers, timestamps and tool names are read or written. No prompt, message or file content, no secret. A test feeds a transcript whose content holds a token and an email and asserts neither reaches the output.
- REQ-5  is generated and overwritten on each run, never edited by hand, and says when it was generated and from which sessions. It is the stored record, because transcripts are local and can be cleaned up.
- REQ-6 The board shows it as an "Agent run" tab next to the track's other documents (overview, plan, spec, tests), with a per-phase table. The board's privacy scan applies to it like any document.
- REQ-7 The first version changes no base plugin text, so there is no new base version for the directory review. A later phase may have the lanes run the script at completion and add a short suffix to the completion line in history.md; that is base text and its own track.
- REQ-8 Use it: run it on finished tracks (10154 first), record what it shows in this spec, and name the biggest inefficiencies. One hypothesis to test: each lane command carries about 27 KB of reference text, so every lane run pays for it before any work starts.
- REQ-9 The post "Pick Your Agent's Brain" (draft under track 10112) uses real output of this script, and every number in it is checked.

## Decisions to settle in the plan lane
- Where the explain of a done track lives on the board: board documents are only published for tracks that are not done, and the finished tracks are the interesting ones. Options: an exception for explain.md, or a project-level "Statistics" tab with totals across tracks (the view that shows what is inefficient overall).
- Dollars: the transcripts carry a cost figure; show it or only tokens.
- Attribution when one session works several tracks (this repository's sessions do): by time window and the track named in the work; document where it is approximate.

## Out of scope
Changing the lane texts, any hook that records timings while the agent works, the database-era run ledger (AM-10100), cost limits or alerts.

## Open questions
- Do sub-agent transcripts sit next to the parent session or in a separate folder in every client (CLI and desktop)? Probe first.
- How are sessions found for a project in the desktop app versus the CLI?
