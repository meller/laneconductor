# Track 1081: Bug — `**Summary**` marker gets silently overwritten with wrong content

**Lane**: plan
**Lane Status**: running
**Progress**: 0%
**Phase**: New — root cause traced for mechanism 1, mechanism 2 still open
**Type**: dev
**Summary**: `index.md`'s `**Summary**` marker gets clobbered with wrong/generic content by at least two distinct mechanisms — one traced to an exact line of code, one only reproduced live and not yet…

## Mechanism 1 (root cause found): hardcoded placeholder text in the auto-answer prompt

`conductor/laneconductor.sync.mjs` line ~3714, inside the `waitingForReply` auto-answer flow
(worker sees a human posted a message in `conversation.md`, spawns an agent to reply):

```js
customPrompt = `The user has sent a message in the track conversation. Read conductor/tracks/${dir}/conversation.md to find their message.
Use /laneconductor comment ${track_number} to post your reply directly in the conversation. If it is a question, answer it. If it is a decision, acknowledge and incorporate it.
You MUST use /laneconductor pulse ${track_number} ${lane_status} ${parseProgress(content)} "Answered user question" when done.`;
```

The 4th argument to the mandated `/laneconductor pulse` call — the summary — is the **literal
string** `"Answered user question"`, not a placeholder the agent is meant to replace. Any track
whose human question gets auto-answered through this path has its real, meaningful
`**Summary**` permanently replaced with this generic text, destroying whatever was there before.

**Evidence this has already caused real damage** (both already committed, predating this
track): `conductor/tracks/LAN-11-per-lane-llm/index.md` and
`conductor/tracks/KAN-861-per-lane-llm/index.md` both literally have
`**Summary**: Answered user question` right now. Track 1008 hit it again today — working tree
diff showed its summary go from "Identify where to inject the override logic in the heartbeat
worker." to exactly this string.

**Likely minimal fix**: don't hardcode the summary text in the prompt template — either drop the
summary argument from the mandated `pulse` call entirely (let the agent pick a real one, or
leave the existing summary untouched if not provided), or instruct the agent explicitly to
generate a one-line summary of *what was actually answered* instead of using fixed text.

## Mechanism 2 (reproduced, not yet root-caused): stale/partial overwrite during active editing

Separately, while directly editing `conductor/tracks/1079-*/index.md` and
`conductor/tracks/1080-*/index.md` via Read/Edit/Write today (no pending human question involved
— mechanism 1 doesn't apply), the `**Summary**` field got overwritten with **stale or truncated**
content multiple times within the same session — not the "Answered user question" placeholder,
but old/partial text, once cutting off mid-sentence. Had to rewrite the file from scratch 3+
times. This looks like a race between this project's own sync worker (which both reads index.md
to sync into the DB, and — per the `updateHeader` regex-replace pattern seen near line 3724 of
sync.mjs — writes back to it) and direct file edits happening concurrently. Track 1009 showed the
same symptom (summary reverted to an old, stale problem-statement) in today's dirty working tree,
independent of any question being answered.

**Not yet traced to a specific line** — needs its own investigation (likely: find every code path
that writes `**Summary**` via regex replace against a `content` variable that could be
stale-read, and check for a read-modify-write race between the worker's periodic scan and
file-watcher-triggered syncs).

## Why this matters

`**Summary**` is what several other places implicitly trust as accurate: the Kanban dashboard
card text, `conductor/tracks.md`'s aggregate summary, and (per this very session) what a human or
agent reads first when triaging a track. Silent corruption here is worse than a crash — it looks
like normal system behavior and actively misleads whoever reads it next.

## Scope note

Two mechanisms, likely two separate fixes. Investigate whether to split into two tracks once
mechanism 2 is root-caused, or keep as one track with two phases if they turn out related.
