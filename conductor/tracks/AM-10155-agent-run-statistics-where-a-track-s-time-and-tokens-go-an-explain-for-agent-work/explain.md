# Agent run: AM-10155-agent-run-statistics-where-a-track-s-time-and-tokens-go-an-explain-for-agent-work

## Insight

These are rule-based observations worked out by the script from the numbers below, not an opinion of a model. No prompt, message or file content is used.

- Time: 25h 19m wall, 12h 29m agent, 12h 50m human, over 10 lane runs.
- Work: 574 replies, 461,936 tokens written, 183,723,414 tokens read from cache (398 times the tokens written), 320,076 per reply on average.
- Context: the first reply of the lane runs in the main session started with 649,159 tokens of context (median of 10 runs, highest 862,564); sub-agents started with a median of 15,545 tokens.
- Sub-agents: 56% of replies and 48% of output, 5 runs.
- Biggest lane by time: implement (13h 58m). Biggest lane by tokens written: implement (390,863).
- Biggest phase by time: Phase 4: Use it (11h 47m). Biggest phase by tokens written: Phase 8: Recommendations for the next run (2026-11-22) (117,025).

**What to look at**

- The review run starting 2026-11-22 01:34 began with 590,520 tokens of context in the main session and only 0% of its replies came from sub-agents: a sub-agent or a fresh session may do the long work with less context.
- The review run starting 2026-11-22 13:06 began with 644,611 tokens of context in the main session and only 0% of its replies came from sub-agents: a sub-agent or a fresh session may do the long work with less context.
- The quality-gate run starting 2026-11-22 13:08 began with 653,706 tokens of context in the main session and only 0% of its replies came from sub-agents: a sub-agent or a fresh session may do the long work with less context.
- The review run starting 2026-11-22 14:26 began with 801,893 tokens of context in the main session and only 0% of its replies came from sub-agents: a sub-agent or a fresh session may do the long work with less context.
- The quality-gate run starting 2026-11-22 14:28 began with 816,545 tokens of context in the main session and only 0% of its replies came from sub-agents: a sub-agent or a fresh session may do the long work with less context.
- 5 lane runs have no claim commit or were never closed (plan, review, review, review, implement): their times are upper bounds; claim the lane when starting it (set it to running).
- 4 gaps of more than 30 minutes between messages.

## Recommendations

These are rule-based suggestions worked out by the script from the numbers below, not an opinion of a model. Tokens only: no dollars and no promise of savings. The model tier is read from the model id (opus above sonnet above haiku), which is a heuristic, not a measure of quality.

- Run the review run starting 2026-11-22 01:34 in a sub-agent or a fresh session: it began with 590,520 tokens of context (limit 400,000) and 0% of its replies came from sub-agents (limit 30%); a sub-agent starts near 50,000 tokens.
- Run the review run starting 2026-11-22 13:06 in a sub-agent or a fresh session: it began with 644,611 tokens of context (limit 400,000) and 0% of its replies came from sub-agents (limit 30%); a sub-agent starts near 50,000 tokens.
- Run the quality-gate run starting 2026-11-22 13:08 in a sub-agent or a fresh session: it began with 653,706 tokens of context (limit 400,000) and 0% of its replies came from sub-agents (limit 30%); a sub-agent starts near 50,000 tokens.
- Run the review run starting 2026-11-22 14:26 in a sub-agent or a fresh session: it began with 801,893 tokens of context (limit 400,000) and 0% of its replies came from sub-agents (limit 30%); a sub-agent starts near 50,000 tokens.
- Run the quality-gate run starting 2026-11-22 14:28 in a sub-agent or a fresh session: it began with 816,545 tokens of context (limit 400,000) and 0% of its replies came from sub-agents (limit 30%); a sub-agent starts near 50,000 tokens.
- plan run starting 2026-11-21 12:08: use a lower effort for this mechanical work (88% of 8 tool calls were shell, read or file edits): effort was high on all 9 replies that record an effort.
- review run starting 2026-11-22 01:34: use a lower effort for this mechanical work (84% of 19 tool calls were shell, read or file edits): thinking was 55% of the output tokens on the 25 replies that record it (limit 30%) and effort was high on all 25 replies that record an effort.
- quality-gate run starting 2026-11-22 13:08: use a lower effort for this mechanical work (88% of 8 tool calls were shell, read or file edits): thinking was 50% of the output tokens on the 8 replies that record it (limit 30%) and effort was high on all 8 replies that record an effort.
- Phase 1: Probe the data: use a lower effort for this mechanical work (94% of 34 tool calls were shell, read or file edits): effort was high on all 34 replies that record an effort.
- Phase 2: The script: use a lower effort for this mechanical work (100% of 43 tool calls were shell, read or file edits): effort was high on all 43 replies that record an effort.
- Phase 3: The board: use a lower effort for this mechanical work (96% of 48 tool calls were shell, read or file edits): effort was high on all 45 replies that record an effort.
- Phase 4: Use it: use a lower effort for this mechanical work (88% of 66 tool calls were shell, read or file edits): thinking was 37% of the output tokens on the 77 replies that record it (limit 30%) and effort was high on all 84 replies that record an effort.
- Phase 5: The post: use a lower effort for this mechanical work (85% of 26 tool calls were shell, read or file edits): thinking was 32% of the output tokens on the 34 replies that record it (limit 30%) and effort was high on all 34 replies that record an effort.
- Phase 6: Corrections and finished tracks (2026-11-22): use a lower effort for this mechanical work (95% of 132 tool calls were shell, read or file edits): thinking was 34% of the output tokens on the 127 replies that record it (limit 30%) and effort was high on all 127 replies that record an effort.
- Phase 7: The insight first (2026-11-22): use a lower effort for this mechanical work (94% of 54 tool calls were shell, read or file edits): effort was high on all 49 replies that record an effort.
- Phase 8: Recommendations for the next run (2026-11-22): use a lower effort for this mechanical work (95% of 102 tool calls were shell, read or file edits): effort was high on all 102 replies that record an effort.
- Claim the lane when starting it (set it to running): 4 of 10 lane runs have no claim commit (plan, review), so their time and tokens are inferred upper bounds.

**Suggested setup for the next run**

- plan: where to run: the main session (as before); model tier: sonnet (as before); effort: medium for the mechanical work (one level below high)
- implement: where to run: a sub-agent (as before); model tier: sonnet (as before); effort: medium for the mechanical work (one level below high)
- review: where to run: a sub-agent or a fresh session; model tier: sonnet (as before); effort: medium for the mechanical work (one level below high)
- quality-gate: where to run: a sub-agent or a fresh session; model tier: sonnet (as before); effort: medium for the mechanical work (one level below high)

Recommendation rules fired: 17

> Generated by lc-explain.mjs from session transcripts and git; do not edit by hand (it is overwritten on each run). Numbers only: no prompt, message or file content is read into it.

Generated: 2026-11-22T14:53:51.874Z
Sources: 1 session file, 7 sub-agent files (sessions 413264fe); the lane and plan boundaries come from git history of this track's index.md and plan.md.

> Approximate: a message is attributed to a track by its time window and working directory or branch, so several tracks that overlap in time can share messages, the computer may have been doing other activity at the same time, and different execution machines run at different speeds. Read these as relative numbers, not exact ones. Human time counts only tasks marked (HUMAN) and the waiting status; a person who chats in the same session without either is counted as agent time, and the gaps of more than 30 minutes are shown as a note only.

## Lane runs

| Lane | Start (UTC) | End (UTC) | Wall | Agent | Human | Responses | Output | Fresh input | Cache created | Cache read | Tool calls | Sub-agent share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plan (no claim commit) | 2026-11-21 12:08 | 2026-11-21 12:12 | 3m | 3m | 0s | 9 | 12,168 | 20 | 28,866 | 3,054,010 | 8 | 0% of responses, 0% of output |
| implement | 2026-11-21 12:19 | 2026-11-22 01:34 | 13h 15m | 25m | 12h 50m | 240 | 131,942 | 536 | 925,972 | 69,409,852 | 217 | 51% of responses, 30% of output |
| review (no claim commit) | 2026-11-22 01:34 | 2026-11-22 12:46 | 11h 12m | 11h 12m | 0s | 25 | 32,026 | 72 | 579,510 | 13,644,183 | 19 | 0% of responses, 0% of output |
| implement | 2026-11-22 12:46 | 2026-11-22 13:06 | 20m | 20m | 0s | 127 | 99,543 | 296 | 228,286 | 34,161,171 | 132 | 70% of responses, 62% of output |
| review (no claim commit) | 2026-11-22 13:06 | 2026-11-22 13:08 | 2m | 2m | 0s | 6 | 6,346 | 14 | 5,311 | 3,878,001 | 5 | 0% of responses, 0% of output |
| quality-gate | 2026-11-22 13:08 | 2026-11-22 13:10 | 2m | 2m | 0s | 8 | 12,513 | 20 | 21,435 | 5,298,654 | 8 | 0% of responses, 0% of output |
| implement | 2026-11-22 14:20 | 2026-11-22 14:26 | 6m | 6m | 0s | 49 | 40,938 | 106 | 106,579 | 11,774,445 | 54 | 76% of responses, 77% of output |
| review (no claim commit) | 2026-11-22 14:26 | 2026-11-22 14:28 | 2m | 2m | 0s | 4 | 4,986 | 14 | 13,954 | 3,212,168 | 5 | 0% of responses, 0% of output |
| quality-gate | 2026-11-22 14:28 | 2026-11-22 14:29 | 43s | 43s | 0s | 2 | 3,034 | 4 | 4,708 | 1,630,202 | 3 | 0% of responses, 0% of output |
| implement (still running) | 2026-11-22 14:36 | 2026-11-22 14:53 | 17m | 17m | 0s | 104 | 118,440 | 226 | 230,862 | 37,660,728 | 104 | 68% of responses, 74% of output |

"no claim commit" marks a lane that moved on without ever being set to running: its window runs from the moment the lane was next in line (queue, or the previous lane done) to the next state change, so it includes any wait in the queue and, in a session shared with other tracks, other tracks' messages. "still running" marks a lane whose status was never closed. Treat both as upper bounds; the Statistics tab keeps them in separate rows from claimed runs.

Tokens are shown apart: output is what the model wrote, fresh input is what it read without the cache, cache created is context stored for reuse, cache read is stored context read again (large and cheap). A response is one model reply; its tokens are counted once even though the transcript writes one line per content block.

## Phases of the implement lane

| Phase | Wall | Agent | Human | Responses | Output | Fresh input | Cache created | Cache read | Tool calls | Sub-agent share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Phase 1: Probe the data | 3m | 3m | 0s | 34 | 4,621 | 70 | 87,781 | 3,728,884 | 34 | 82% of responses |
| Phase 2: The script | 9m | 7m | 2m | 43 | 22,630 | 86 | 103,745 | 6,032,862 | 43 | 100% of responses |
| Phase 3: The board | 8m | 8m | 0s | 45 | 13,386 | 92 | 98,452 | 6,676,916 | 48 | 84% of responses |
| Phase 4: Use it | 11h 47m | 2m | 11h 45m | 84 | 60,498 | 206 | 571,434 | 35,497,596 | 66 | 13% of responses |
| Phase 5: The post | 1h 08m | 5m | 1h 03m | 34 | 30,807 | 82 | 64,560 | 17,473,594 | 26 | 9% of responses |
| Phase 6: Corrections and finished tracks (2026-11-22) | 20m | 20m | 0s | 127 | 99,543 | 296 | 228,286 | 34,161,171 | 132 | 70% of responses |
| Phase 7: The insight first (2026-11-22) | 6m | 6m | 0s | 49 | 40,938 | 106 | 106,579 | 11,774,445 | 54 | 76% of responses |
| Phase 8: Recommendations for the next run (2026-11-22) | 16m | 16m | 0s | 102 | 117,025 | 222 | 229,265 | 36,568,294 | 102 | 69% of responses |
| After the last tick (wrap-up) | 36s | 36s | 0s | 2 | 1,415 | 4 | 1,597 | 1,092,434 | 2 | 50% of responses |

- Phase 1: Probe the data: replies by model claude-sonnet-5-5 34; thinking 423 of 4,300 output tokens (10%, recorded on 7 of 34 replies); effort high 34; path Agent x1, Bash x17, Write x1, Artifact x1, Bash x2, Write x1, Bash x4, Edit x1, ...
- Phase 2: The script: replies by model claude-sonnet-5-5 43; thinking 2,377 of 22,268 output tokens (11%, recorded on 10 of 43 replies); effort high 43; path Bash x1, Write x1, Bash x1, Write x4, Bash x15, Write x1, Bash x20
- Phase 3: The board: replies by model claude-sonnet-5-5 45; thinking 3,503 of 13,149 output tokens (27%, recorded on 20 of 45 replies); effort high 45; path Bash x5, Write x2, Bash x5, Agent x1, Bash x15, Artifact x1, Bash x19
- Phase 4: Use it: replies by model claude-sonnet-5-5 84; thinking 22,362 of 60,406 output tokens (37%, recorded on 77 of 84 replies); effort high 84; path Bash x2, SendMessage x1, Bash x7, Write x1, Bash x2, SubagentHandback x1, Bash x6, Artifact x1, ...
- Phase 5: The post: replies by model claude-sonnet-5-5 34; thinking 9,737 of 30,807 output tokens (32%, recorded on 34 of 34 replies); effort high 34; path Bash x2, SubagentHandback x1, Bash x6, Artifact x1, Bash x2, SendUserFile x1, Bash x8, SendUserFile x1, ...
- Phase 6: Corrections and finished tracks (2026-11-22): replies by model claude-sonnet-5-5 127; thinking 34,166 of 99,543 output tokens (34%, recorded on 127 of 127 replies); effort high 127; path Agent x1, Bash x12, Artifact x1, Bash x8, Edit x1, Bash x10, Write x1, Bash x4, ...
- Phase 7: The insight first (2026-11-22): replies by model claude-sonnet-5-5 49; thinking 8,616 of 40,938 output tokens (21%, recorded on 49 of 49 replies); effort high 49; path Agent x1, Bash x11, Artifact x1, Bash x1, Write x1, Bash x22, Write x1, Bash x11, ...
- Phase 8: Recommendations for the next run (2026-11-22): replies by model claude-sonnet-5-5 102; thinking 34,767 of 117,025 output tokens (30%, recorded on 102 of 102 replies); effort high 102; path Agent x1, Bash x10, Write x1, Bash x2, Artifact x1, Bash x1, Write x1, Bash x7, ...
- After the last tick (wrap-up): replies by model claude-sonnet-5-5 2; thinking 280 of 1,415 output tokens (20%, recorded on 2 of 2 replies); effort high 2; path Bash x2

A phase runs from the previous plan tick (or the claim) to the tick of its last task; a `(HUMAN)` task is human time. Tasks ticked in the same commit share their stretch of time equally, because the commit does not say which took longer.

## Detail: plan run starting 2026-11-21 12:08

- Tool calls by kind: Bash 7, Artifact 1
- Files read more than once: 0 repeated reads
- Context of the first response of the run: 331,766 tokens
- Replies by model: claude-sonnet-5-5 9
- Thinking tokens: 2,212 of 12,168 output tokens on the 9 of 9 replies that record them (18%)
- Effort levels seen: high 9
- Path (tool kinds in the order used): Bash x3, Artifact x1, Bash x4
- Gaps of more than 30 minutes between messages: 0 (a note only)
- Slowest tool steps (call to result, so a permission wait is included): Bash 46s at 2026-11-21 12:09; Artifact 3s at 2026-11-21 12:10; Bash 2s at 2026-11-21 12:10; Bash 2s at 2026-11-21 12:12; Bash 2s at 2026-11-21 12:09

## Detail: implement run starting 2026-11-21 12:19

- Tool calls by kind: Bash 189, Write 11, SendUserFile 6, Artifact 4, Agent 2, SubagentHandback 2, AskUserQuestion 1, Edit 1, SendMessage 1
- Files read more than once: 0 repeated reads
- Context of the first response of the run: 378,337 tokens; 2 sub-agent runs started with a median of 13,461 tokens of context
- Questions put to the human (the AskUserQuestion tool): 1, waited 2m in total (a note only; the Human column counts only the (HUMAN) tasks and the waiting status)
- Replies by model: claude-sonnet-5-5 240
- Thinking tokens: 38,402 of 130,930 output tokens on the 148 of 240 replies that record them (29%)
- Effort levels seen: high 240
- Path (tool kinds in the order used): Agent x1, Bash x17, Write x1, Artifact x1, Bash x2, Write x1, Bash x4, Edit x1, ...
- Gaps of more than 30 minutes between messages: 3 (a note only)
- Slowest tool steps (call to result, so a permission wait is included): Bash 2m at 2026-11-21 12:32; Bash 58s at 2026-11-22 00:22; Bash 47s at 2026-11-21 23:53; Bash 46s at 2026-11-22 00:38; Bash 45s at 2026-11-21 12:20

## Detail: review run starting 2026-11-22 01:34

- Tool calls by kind: Bash 16, SendUserFile 2, Artifact 1
- Files read more than once: 0 repeated reads
- Context of the first response of the run: 590,520 tokens
- Replies by model: claude-sonnet-5-5 25
- Thinking tokens: 17,693 of 32,026 output tokens on the 25 of 25 replies that record them (55%)
- Effort levels seen: high 25
- Path (tool kinds in the order used): Bash x1, Artifact x1, Bash x7, SendUserFile x1, Bash x1, SendUserFile x1, Bash x7
- Gaps of more than 30 minutes between messages: 1 (a note only)
- Slowest tool steps (call to result, so a permission wait is included): Bash 43s at 2026-11-22 01:34; Bash 18s at 2026-11-22 12:42; Bash 18s at 2026-11-22 12:42; SendUserFile 18s at 2026-11-22 12:42; Artifact 3s at 2026-11-22 01:35

## Detail: implement run starting 2026-11-22 12:46

- Tool calls by kind: Bash 111, Edit 12, Write 2, Agent 1, Artifact 1, ListPlugins 1, Read 1, SendMessage 1, SubagentHandback 1, ToolSearch 1
- Files read more than once: 0 repeated reads
- Context of the first response of the run: 587,925 tokens; 1 sub-agent run started with a median of 15,545 tokens of context
- Replies by model: claude-sonnet-5-5 127
- Thinking tokens: 34,166 of 99,543 output tokens on the 127 of 127 replies that record them (34%)
- Effort levels seen: high 127
- Path (tool kinds in the order used): Agent x1, Bash x12, Artifact x1, Bash x8, Edit x1, Bash x10, Write x1, Bash x4, ...
- Gaps of more than 30 minutes between messages: 0 (a note only)
- Slowest tool steps (call to result, so a permission wait is included): Bash 44s at 2026-11-22 12:47; Bash 44s at 2026-11-22 12:49; Bash 42s at 2026-11-22 13:02; Bash 41s at 2026-11-22 12:59; Bash 40s at 2026-11-22 12:56

## Detail: review run starting 2026-11-22 13:06

- Tool calls by kind: Bash 3, Artifact 1, Skill 1
- Files read more than once: 0 repeated reads
- Context of the first response of the run: 644,611 tokens
- Replies by model: claude-sonnet-5-5 6
- Thinking tokens: 3,506 of 6,346 output tokens on the 6 of 6 replies that record them (55%)
- Effort levels seen: high 6
- Path (tool kinds in the order used): Bash x1, Artifact x1, Bash x1, Skill x1, Bash x1
- Gaps of more than 30 minutes between messages: 0 (a note only)
- Slowest tool steps (call to result, so a permission wait is included): Bash 43s at 2026-11-22 13:06; Artifact 8s at 2026-11-22 13:07; Bash 7s at 2026-11-22 13:07; Bash 2s at 2026-11-22 13:08; Skill 0s at 2026-11-22 13:07

## Detail: quality-gate run starting 2026-11-22 13:08

- Tool calls by kind: Bash 7, Artifact 1
- Files read more than once: 0 repeated reads
- Context of the first response of the run: 653,706 tokens
- Replies by model: claude-sonnet-5-5 8
- Thinking tokens: 6,271 of 12,513 output tokens on the 8 of 8 replies that record them (50%)
- Effort levels seen: high 8
- Path (tool kinds in the order used): Artifact x1, Bash x7
- Gaps of more than 30 minutes between messages: 0 (a note only)
- Slowest tool steps (call to result, so a permission wait is included): Bash 21s at 2026-11-22 13:08; Bash 2s at 2026-11-22 13:10; Bash 1s at 2026-11-22 13:09; Bash 1s at 2026-11-22 13:09; Bash 0s at 2026-11-22 13:09

## Detail: implement run starting 2026-11-22 14:20

- Tool calls by kind: Bash 49, Write 2, Agent 1, Artifact 1, SubagentHandback 1
- Files read more than once: 0 repeated reads
- Context of the first response of the run: 784,853 tokens; 1 sub-agent run started with a median of 15,618 tokens of context
- Replies by model: claude-sonnet-5-5 49
- Thinking tokens: 8,616 of 40,938 output tokens on the 49 of 49 replies that record them (21%)
- Effort levels seen: high 49
- Path (tool kinds in the order used): Agent x1, Bash x11, Artifact x1, Bash x1, Write x1, Bash x22, Write x1, Bash x11, ...
- Gaps of more than 30 minutes between messages: 0 (a note only)
- Slowest tool steps (call to result, so a permission wait is included): Bash 46s at 2026-11-22 14:26; Bash 43s at 2026-11-22 14:20; Bash 19s at 2026-11-22 14:26; Bash 19s at 2026-11-22 14:25; Bash 18s at 2026-11-22 14:24

## Detail: review run starting 2026-11-22 14:26

- Tool calls by kind: Bash 3, Artifact 1, Skill 1
- Files read more than once: 0 repeated reads
- Context of the first response of the run: 801,893 tokens
- Replies by model: claude-sonnet-5-5 4
- Thinking tokens: 2,395 of 4,986 output tokens on the 4 of 4 replies that record them (48%)
- Effort levels seen: high 4
- Path (tool kinds in the order used): Artifact x1, Bash x1, Skill x1, Bash x2
- Gaps of more than 30 minutes between messages: 0 (a note only)
- Slowest tool steps (call to result, so a permission wait is included): Bash 21s at 2026-11-22 14:28; Bash 6s at 2026-11-22 14:28; Artifact 1s at 2026-11-22 14:27; Bash 1s at 2026-11-22 14:27; Skill 0s at 2026-11-22 14:28

## Detail: quality-gate run starting 2026-11-22 14:28

- Tool calls by kind: Bash 2, Artifact 1
- Files read more than once: 0 repeated reads
- Context of the first response of the run: 816,545 tokens
- Replies by model: claude-sonnet-5-5 2
- Thinking tokens: 338 of 3,034 output tokens on the 2 of 2 replies that record them (11%)
- Effort levels seen: high 2
- Path (tool kinds in the order used): Artifact x1, Bash x2
- Gaps of more than 30 minutes between messages: 0 (a note only)
- Slowest tool steps (call to result, so a permission wait is included): Bash 3s at 2026-11-22 14:29; Bash 1s at 2026-11-22 14:29; Artifact 1s at 2026-11-22 14:28

## Detail: implement run starting 2026-11-22 14:36

- Tool calls by kind: Bash 83, Write 12, Artifact 4, Edit 3, Agent 1, Read 1
- Files read more than once: 0 repeated reads
- Context of the first response of the run: 862,564 tokens; 1 sub-agent run started with a median of 15,994 tokens of context
- Replies by model: claude-sonnet-5-5 104
- Thinking tokens: 35,047 of 118,440 output tokens on the 104 of 104 replies that record them (30%)
- Effort levels seen: high 104
- Path (tool kinds in the order used): Agent x1, Bash x10, Write x1, Bash x2, Artifact x1, Bash x1, Write x1, Bash x7, ...
- Gaps of more than 30 minutes between messages: 0 (a note only)
- Slowest tool steps (call to result, so a permission wait is included): Bash 1m at 2026-11-22 14:47; Bash 45s at 2026-11-22 14:37; Bash 45s at 2026-11-22 14:51; Bash 44s at 2026-11-22 14:40; Bash 31s at 2026-11-22 14:48

## Model use

- Replies by model (all lane runs): claude-sonnet-5-5 574 (574 replies)
- Thinking tokens: 148,646 of 460,924 output tokens on the 482 of 574 replies that record them (32%)
- Effort levels seen: high 574

The model id, the thinking token count and the effort level are read from the numbers each reply records; "unknown" means the reply carries none, and a reply that does not record thinking tokens is not counted as zero. "synthetic" marks placeholder replies no model wrote.

## Outside every lane run

Responses in the scanned sessions of this repository that fall outside every lane window of this track: 108 (92,438 output tokens). Left out as not this track: 0 on another track's branch or sub-agent, 0 in another folder.

