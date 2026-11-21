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
- REQ-3 Per lane and per phase: wall-clock split into active time and waiting on a human (human time from the `(HUMAN)` plan markers and the waiting status, see D4); tokens as output, fresh input, cache creation and cache reads, shown separately (cache reads dominate and cost little); tool calls by kind; the slowest steps; the share done by sub-agents; files read more than once, as a count of repeats (see REQ-4).
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

## Decisions (2026-11-21, plan lane; D1 to D3 and D5 confirmed by the owner the same day, D4 changed by the owner)
- D1 (confirmed) Visible while the work runs and after: the track's own "Agent run" tab shows the statistics during and after the work (the `explain.md` is rewritten on each run); when a track is finished it is aggregated into a project-level "Statistics" tab (a project file generated from every track's `explain.md`), with one row per track and the lane and phase totals. That tab is also the view that shows what is inefficient overall.
- D2 (confirmed) Tokens only; no dollars for now.
- D3 (confirmed) Attribution by time window plus the working directory or branch. Every table carries a note next to the numbers: approximate, because the machine may have been doing other things, several tracks can overlap in time, and different execution machines differ; it gives a relative number, not an exact one.
- D4 (changed by the owner) Human time comes from the human markers, not from a gap threshold: a plan task marked `(HUMAN)` and a lane status of `waiting` (from the dated history lines) are counted as human time and kept apart; the rest is agent time. This is simple and uses what the tracks already say. Known limit: a person who chats in the same session during a lane (not marked anywhere) is counted as agent time; the table says so, and the number of gaps over 30 minutes is shown as a note only.
- D5 (confirmed) The core stays untouched: `explain.md` is a plain Markdown document in the track folder, like the plan and tests, and the board reads it as one more document. The statistics need a script, because the transcripts are large JSON Lines files that cannot be read by hand reliably; the script lives in the board add-on (`connector/bin/lc-explain.mjs`), never in the core plugin, which keeps scripts out of the base plugin and its directory review. A later, separate track may have the core lanes call the script when the add-on is present (base text).

## Out of scope
Changing the lane texts, any hook that records timings while the agent works, the database-era run ledger (AM-10100), cost limits or alerts.

## Open questions
- Does a plain CLI session use the same folder layout for sub-agents and the same fields (the probe above was the desktop app)?
- How should a message be attributed when two tracks were worked in the same minutes (a parallel dispatch)? D3 says approximate; check how often it happens before building more.

## Probe results, Phase 1 (2026-11-21, implement lane)
- Same layout in a CLI session (`entrypoint: cli`) and in an sdk-cli sub-agent file as in the desktop app: `sessionId`, `timestamp`, `cwd`, `gitBranch`, `requestId`, `message.id` and a `usage` record on every assistant line; sub-agent files carry `agentId` and a `.meta.json` next to them whose description names the track (only the digits are used). Answers the first open question.
- One API response is written once per content block (thinking, text, tool_use), each with the same usage: in the probed session 13,773 assistant lines are 6,828 responses. Counting lines would roughly double every number, so the script counts per message id (a streaming line can hold a smaller output count, so the largest value wins). This corrects the "about 13,700 messages" figure in the probe findings above.
- Parallel dispatch (second open question): a sub-agent run is attributed by the track number in its meta description, a worktree session by branch `track-N` or folder `.worktrees/N`; only main-session messages written in the same minutes remain ambiguous and are counted in the window of every track whose lane run covers them (the approximation note says so).
- Many tracks have no claim commit (the lane goes queue to success, or plan success to review queue). The script then infers the lane that was next in line and marks the row "(no claim commit)"; its window includes queue waiting. Statistics keep claimed, inferred and still-running rows apart.

## Findings, Task 10 (2026-11-21, `lc-explain.mjs` on 10154, 10146, 10114, 10116)
Check (TC-7): per lane run, responses and all four token kinds equal an independent recomputation (dedupe by request id, separate code) exactly on 10154 (3 runs), 10146, 10114 and 10116; the one first mismatch (10114 plan, minus 10 percent) was other tracks' `.worktrees/N` messages that the independent script had not excluded. All numbers below are approximate (tracks overlap in time, the machine does other things, machines differ).
- Cache reads dominate: 10154 read 15.8M cache tokens against 43.6K output (about 360 times) in 79 responses; 10146 read 106.6M against 196.9K output (about 540 times) in 401 responses. Every response re-reads the whole session context: 200K on average (10154), 266K (10146); the first response of a lane run in the long-lived main session already holds 646K to 958K tokens of context. Cache created is only about 1 to 1.5 percent of the cache read.
- The lane-text hypothesis (27 KB, about 7K tokens per lane command) is small next to that: about 3 percent of one response's context and paid once per run. Sub-agent runs start much lighter (median 35K to 57K tokens of context against 95K to 770K for the orchestrating session), so work done by a sub-agent in its own worktree is cheaper per response than the same work in the long session. In 10128 sub-agents did 66 percent of responses and 44 percent of output.
- Biggest inefficiency: lane work run inside one months-long session (the context grows to near 1M tokens and is re-read on every reply). Second, process hygiene: lanes never closed ("quality-gate (still running)" on 10130, 10133 and 10141 to 10145, about 66 hours) and lanes never claimed (queue straight to success), which makes their time unmeasurable; about half of the tracks surveyed have only inferred windows. Human time shows only where `(HUMAN)` tasks or waiting statuses exist (10154: 3 of 20 minutes); a question put to the human (AskUserQuestion) is shown as a note, not counted.
- Repeated reads: 0 on every track checked; slowest tool steps are Bash calls of 40 to 60 seconds (tests, publishing), no pattern worth a fix.
- For the owner (Task 11, not done): have the lanes run the script at completion (base text, separate track), and consider whether lane work should default to sub-agents or fresh sessions.
