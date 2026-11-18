# Spec: Owner steps: a track that stops at a real-world action, runs a window, and closes with a result

## Problem Statement

A track often reaches a step only the owner can do: record a video, post in a group, choose a channel, approve spend, submit to a directory. LaneConductor has `waiting` and a one-line `Waiting Reason`, but nothing says what exactly to do, gives the owner a ready kit, says when to look again, or reads the result and closes the track. Found on a real project: 11 marketing-type tracks, most stopped at such a step; some never started, others waited for weeks unseen.

This is not marketing-only. Any track with a human step has it (our own: submit to a directory, approve a deploy). Marketing and sales are the clearest case, because the result (sign-ups, replies, sales) must be read back to know whether the work worked.

Owner direction (2026-11-18): the LaneConductor way: files in git, markers, lanes and statuses. No new lanes, no new infrastructure, no marketing tool. The plugin works in a track context by default (see track 10124, REQ-12).

## The shape of an owner-step track

The stages map onto the lanes and statuses that exist today:

| Stage | Lane and status | Who | Output |
|-------|-----------------|-----|--------|
| Prepare | implement, running | agent | the kit: copy, page, tagged link, schedule (in spec.md) |
| Owner action | implement, waiting, with `Owner Action` | owner | one concrete task with a due date, the kit attached |
| Run | review, waiting until `Resume On` | nobody | the window in which results accumulate |
| Readout | review, running | agent | what happened, what we learned, the next step, written into `Result` and a history line |
| Close | done, success | owner confirms | closed with `Result`; a killed campaign closes the same way, with `killed:` and the reason in `Result` |

## Requirements

- REQ-1 Markers (optional, plain `**Name**: value` lines in index.md, read by the connector's marker parser): `Owner Action` (one line: what the owner must do), `Owner Action Due` (a date, `YYYY-MM-DD`), `Resume On` (a date when a `waiting` track is due for a look), `Result` (one line: what happened, with the numbers that were read, and the learning), and `Source Tag` (the value the results are read by, for example a UTM tag). Absent means not an owner-step track; nothing changes for other tracks.
- REQ-2 The kit lives in spec.md under a `## Kit` heading: the text to post or send, the tagged link, the time, any asset. It is written in the prepare stage, before the track waits, so the owner can act without asking.
- REQ-3 A kill rule is written in spec.md before the run (a one-line condition such as "stop after 14 days with under N sign-ups"); the readout applies it.
- REQ-4 `next` ranks owner actions: a track `waiting` with `Owner Action` is shown with the action, its due date and the kit pointer, oldest due first, overdue first; a track whose `Resume On` date has passed is offered as "read out track N". More than two open owner actions get one line of advice (finish one first); it is advice, not a gate.
- REQ-5 The board shows the owner action and its due date on the card and in the What's next panel; an overdue action is marked in text (and colour) and listed in needs-attention; a track past `Resume On` is listed as due for a readout.
- REQ-6 Closing: a track of type marketing or sales that reaches `done` with no `Result` gets a lint warning (`result_missing`) from the connector, the review lane guide and the quality gate; it is a warning, not a block, because the connector's rule is a second opinion.
- REQ-7 The lane guides for non-dev tracks say what each stage writes and where the track stops: implement (supervised) ends the prepare stage by writing the kit and the kill rule, then sets `waiting` with `Owner Action` and `Owner Action Due`; review at `Resume On` does the readout; nothing is written without the numbers (a readout never invents a number; if the numbers are not available it says so and asks the owner).
- REQ-8 Core stays small: the campaign template (the headings, the kill rule wording), channel kits (one posting template and a log per channel) and the readout format are SKILLS in the person's own library or the marketing pack the advisor offers (track 10124), not text in the base plugin.
- REQ-9 It works with and without the connector: the markers are plain lines, so the base alone does it by editing files; the connector adds the lint and the date logic in `list_tracks` and `get_track`.

## Decisions

- 2026-11-18 (proposed, owner to confirm): general "owner step", not marketing-only. A track of any Type may carry the markers.
- 2026-11-18 (proposed, owner to confirm): a campaign is a TEMPLATE of the existing `marketing` and `sales` types, not a new Type and not a new lane.
- 2026-11-18 (proposed, owner to confirm): the cap on open owner actions is advice in `next` (default 2), not a gate.
- 2026-11-18 (proposed): a killed campaign closes as `done:success` with `killed:` in `Result`, because `done:failure` already means the merge failed.
- 2026-11-18: no new lanes; the stages use the lanes and statuses above. Builds on track 10136 (Waiting Reason, ready-to-resume) and on the board work of track 10115.

## Data model and API

- Markers in index.md as in REQ-1. The marker parser already reads any `**Name**: value` line; the new names are added to the documented marker table in the skill and to `list_tracks` and `get_track` output (`owner_action`, `owner_action_due`, `resume_on`, `result`, `source_tag`, plus computed `overdue` and `readout_due`).
- `update_track` already sets and removes arbitrary markers; no new tool and no new tool description text (the context-size test is nearly full).
- Board: `board.json` carries the owner-step fields only for tracks that have them (short keys, like the type and priority keys).
- `next`: a new candidate class "owner action" and "readout due" in the shared ranking (`connector/src/next.mjs`).

## Acceptance criteria

- [ ] The markers are documented and read by the connector, and tracks without them behave as before (REQ-1, REQ-9).
- [ ] A `waiting` track with an owner action appears in `next` with the action, due date and kit pointer, overdue first; one past `Resume On` is offered as a readout; more than two open actions add one line of advice (REQ-4).
- [ ] The board shows the owner action and due date on the card and in What's next, marks an overdue one, and lists a readout due (REQ-5).
- [ ] A marketing or sales track closed without `Result` gets the `result_missing` warning (REQ-6).
- [ ] The lane guides for non-dev tracks describe the stages, the kit, the kill rule and the readout, with the "never invent a number" rule (REQ-2, REQ-3, REQ-7).
- [ ] The base plugin stays Markdown only and short; the template, channel kits and readout format are not in it (REQ-8).
- [ ] A real run: one marketing track (the comparison page, track 10119, or a posts-program track) goes through prepare, owner action, run, readout and close using the markers (HUMAN).

## Risks and limits

- It is advice in Markdown plus markers and a lint; Claude follows it, nothing forces it. An owner who never looks at `next` or the board will not see the action either.
- Dates in markers are plain text; a mistyped date is reported by the lint, not guessed.
- Scope creep: this must not grow into a marketing automation tool. Posting, sending and spending stay with the owner.
- The readout needs numbers from somewhere (analytics, a dashboard). Where they come from is per project, in its own `conductor/` files; LaneConductor only defines where the result is written.
- Directory policy: the base text stays short and useful on its own; the extra text for non-dev tracks is small.

## Out of scope

- Sending, posting or spending for the owner; connecting to analytics products; a new lane or Type; a hard cap on owner actions; the campaign template, channel kits and readout format themselves (they are skills, REQ-8).
