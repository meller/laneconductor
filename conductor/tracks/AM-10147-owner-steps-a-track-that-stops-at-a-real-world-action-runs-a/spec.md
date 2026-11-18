# Spec: Owner steps: a track that stops at a real-world action, runs a window, and closes with a result

## Problem Statement

A track often reaches a step only the owner can do: record a video, post in a group, choose a channel, approve spend, submit to a directory. Found on a real project: 11 marketing-type tracks, most stopped at such a step; some never started, others waited for weeks unseen.

This is not marketing-only. Any track with a human step has it (our own: submit to a directory, approve a deploy). Marketing and sales are the clearest case, because the result must be read back to know whether the work worked.

Owner direction (2026-11-18): the LaneConductor way: files in git, markers, lanes and statuses; no new lanes, no new infrastructure, no marketing tool. The plugin works in a track context by default (track 10124, REQ-12).

## What already exists (reuse, do not add a parallel flow)

The plan review of 2026-11-18 found that non-dev tracks already carry most of this shape in the lane guides. This track reuses it and fills the gaps:

| Stage | Exists today | Where |
|-------|--------------|-------|
| Target and kill rule | the `## KPI` block: Target, Metric, Source, Source Config, Threshold, Window | `lanes/plan.md` step 4 |
| The kit | the `## Draft` section with `### Publish Instructions` | `lanes/plan.md` step 5 |
| Prepare, then stop for the owner | supervised implement outputs the draft, sets `Waiting for reply: yes`, stops | `lanes/implement.md` step 4 |
| The run window | `KPI Check After` in index.md; the quality gate asks before measuring early | `lanes/quality-gate.md` step 0b |
| Readout | the quality gate's KPI step reads the source, writes `KPI Actual` and `KPI Snapshot`, and on a miss writes a `## KPI MISS` entry and replans | `lanes/quality-gate.md` step 1 |

## The gaps this track fills

- G1 The owner action is not named. `next` shows any waiting track as "answer a reply" (state S05), whose card says "adds your answer to the conversation", which is wrong for "post this in the group".
- G2 No due date, so nothing can be overdue and a stalled owner step is invisible.
- G3 Without a daemon, nothing moves the track on after the owner says "done", and nothing sets `KPI Check After` (the daemon's inbox did).
- G4 `next` and the board never offer "the window has ended: measure track N".
- G5 There is no one-line outcome that closes the track, and no warning when a marketing or sales track closes without a measured KPI.
- G6 Nothing says how many open owner actions are too many.

## Requirements

- REQ-1 Three new optional markers in index.md, plain `**Name**: value` lines read by the marker parser (added to its canonical names so a hand-typed `**owner action**` is read too): `Owner Action` (one line: what the owner must do, up to 200 characters), `Owner Action Due` (a date, `YYYY-MM-DD`) and `Result` (one line, up to 200 characters; the full learning goes in `history.md`). Absent means not an owner-step track; nothing changes for other tracks. No `Resume On` and no `Source Tag`: `KPI Check After` is the resume date and the KPI block's `Source` is the source.
- REQ-2 The kit is the existing `## Draft` section; the kill rule is the existing `## KPI` Threshold plus Window (a track that has none writes one line `**Kill rule**: ...` inside the KPI block). No new heading and no new file.
- REQ-3 A track that has an `Owner Action` is a `waiting` track with `Waiting for reply: yes`, as supervised implement already leaves it. `Owner Action` satisfies the existing lint that a `waiting` track needs a `Waiting Reason`.
- REQ-4 When the owner says the action is done (a comment such as "posted", or `move`), the agent clears `Owner Action` and `Owner Action Due`, sets `KPI Check After` to now plus the KPI Window, and parks the track in the quality-gate lane as `waiting` with a `Waiting Reason` naming the date. Nothing moves a track by itself; this is what the guide tells the agent to do on that reply.
- REQ-5 `next` ranks: (a) a new state "do the owner action" for a waiting track with an `Owner Action`, placed where S05 is today and ahead of it for such tracks, showing the action, its due date and the pointer to `## Draft`; overdue first, then oldest due; (b) a new state "measure the KPI" for a track whose `KPI Check After` has passed, with the command `/laneconductor:quality-gate N`. More than two open owner actions add one line of advice (finish one first); advice only, never a gate, never a change of order. A track with an `Owner Action` and no valid due date still appears, last among them, with "no due date". Ranking among equals follows the existing key (state group, priority, lane, number).
- REQ-6 The board shows the owner action and due date on the card and in What's next; an overdue action is marked in text and colour and listed in needs-attention; a window that has ended is listed as "ready to measure". The page computes overdue at render from today's date (UTC date, said in the page), not at generation, so an old snapshot does not lie.
- REQ-7 Lint, advisory only (warnings in `get_track`, `list_tracks` and the Needs attention block of the generated summary, never a block): `date_malformed` (a due date or `KPI Check After` that is not a real `YYYY-MM-DD` date, found with a strict pattern and a calendar check) and `outcome_missing` (a marketing or sales track with a `## KPI` block at `done:success` with neither `KPI Actual` nor `Result`; older tracks without a KPI block are exempt). The same warnings reach `next` and the board as visible reasons.
- REQ-8 Lane guides (small additions to the existing text, written once and shared): supervised implement writes `Owner Action` and `Owner Action Due` before it sets `Waiting for reply: yes`; the reply handling of REQ-4; the quality gate, after its KPI step, writes `Result` (one line) and a history line, and applies the kill rule: a miss with the window used up closes the track as `done:success` with `killed:` and the reason in `Result` (owner confirmed 2026-11-18). A readout never invents a number; when the source cannot be read it asks the owner for the number (existing behaviour).
- REQ-9 Core stays small. The campaign template (headings, kill-rule wording), channel kits (a posting template and a log per channel) and the readout format are skills in the person's own library or the marketing pack the advisor offers (track 10124), not text in the base plugin.
- REQ-10 Base alone (no connector): the markers are plain lines the agent reads and writes with its file tools; `next` is the procedure in `ops/next.md`, which tells the agent to compare dates with today's date (and ask when it does not know it). The lint, computed flags and board need the connector or the board add-on; the base text says so once.

## Decisions

- 2026-11-18 (owner confirmed): general owner step, not marketing-only.
- 2026-11-18 (owner confirmed): a campaign is a template of the existing marketing and sales types; no new Type and no new lane.
- 2026-11-18 (owner confirmed): the cap on open owner actions is advice in `next` (default 2).
- 2026-11-18 (owner confirmed): a killed campaign closes as `done:success` with `killed:` in `Result`, because `done:failure` means the merge failed.
- 2026-11-18: reuse before adding (found by the plan review): the kit is `## Draft`, the kill rule is the KPI Threshold and Window, the resume date is `KPI Check After`, the readout is the quality gate's KPI step. Only `Owner Action`, `Owner Action Due` and `Result` are new. The earlier proposal's `Resume On` and `Source Tag` are dropped.
- 2026-11-18: dates are UTC calendar dates; due today is not overdue; a `KPI Check After` of today or earlier is due. Documented once, in the skill.

## Data model and API

- Markers as in REQ-1, added to the canonical marker names (`markers.mjs`), the marker table in SKILL.md and `ops/settings`-style docs. `rowOf` and `generateSummary` stay pure (no clock): the computed `overdue` and `ready_to_measure` flags are computed by a small function that takes today's date, used by `next`, `list_tracks` and `get_track` (`ctx.now()`) and by the board page at render.
- `list_tracks` and `get_track`: `owner_action`, `owner_action_due`, `result`, plus the computed flags; omitted when unset. No new tool and no new tool description text (the context-size test is nearly full).
- `next`: new states (the next free ids after the current 21), with their SHAPES, text and word rows and the table in `ops/next.md`; the test that compares the ops text with the code stays.
- Board: `board.json` carries the fields only for tracks that have them (short keys like the type and priority keys); the page renders and escapes the free text.

## Acceptance criteria

- [ ] Tracks without the markers behave exactly as before in `list_tracks`, `get_track`, `next` and the board (REQ-1).
- [ ] The three markers are read case-insensitively and set and removed with `update_track` (REQ-1).
- [ ] A waiting track with an owner action appears in `next` as its own state with the action and due date, overdue first, ahead of S05; one past `KPI Check After` is offered as a measurement; a third open action adds one line of advice (REQ-5).
- [ ] The board shows the action and due date, marks overdue at render, and lists a window ready to measure (REQ-6).
- [ ] `date_malformed` and `outcome_missing` appear where specified and never block (REQ-7).
- [ ] The lane guides describe the owner-action, reply and readout steps with the shared text and the never-invent-a-number rule, within the size limits (REQ-4, REQ-8).
- [ ] The base carries no campaign template, channel kit or readout format; the template and kits exist as skills outside the core (REQ-9).
- [ ] A real run: one marketing track goes through prepare, owner action, run window, measurement and close (HUMAN).

## Risks and limits

- It is advice in Markdown plus markers and a lint; Claude follows it, nothing forces it. An owner who never looks at `next` or the board will not see the action either.
- Dates are UTC; for an owner far from UTC the day flips a few hours off. Stated in the skill and on the page.
- A malformed due date makes the exact failure this track exists to remove (silent). So the action still shows in `next`, last, with the warning, and the warning reaches the board.
- The generated `tracks-summary.md` changes for projects that have such tracks (new warnings); mention it in the release note.
- Scope: this must not grow into marketing automation. Posting, sending and spending stay with the owner.
- The numbers come from the KPI block's Source (existing) or from the owner; there is no connection to analytics products.
- Directory policy: the base text stays short; additions are merged into existing KPI and Draft text and written once, not repeated per guide.

## Out of scope

- Sending, posting or spending for the owner; analytics connections; a new lane or Type; a hard cap; the template, kits and readout format themselves (skills).
