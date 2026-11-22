# Plan: AM-10155

## Phase 1: Probe the data
- [x] Task 1: Repeat the probe of the spec's "Probe findings" on a plain CLI session and on a worktree session, and write down what differs (REQ-1, REQ-3)
- [x] Task 2: Settle the two open questions in the spec and fold the answers into the decisions D1 to D5

## Phase 2: The script
- [x] Task 3 (test first): Boundaries from the track files and git: lane runs and phases with their start and end (REQ-2)
- [x] Task 4: Attribute transcript messages to a lane or phase by time window and working directory; agent time versus human time from the `(HUMAN)` markers and waiting lines (REQ-2, REQ-3, D4)
- [x] Task 5: Token split, tool calls by kind, slowest steps, sub-agent share, repeated reads as counts (REQ-3)
- [x] Task 6: Write `explain.md` (generated, overwritten, with its sources and time) and print the same table (REQ-1, REQ-5)
- [x] Task 7: The privacy test: a transcript with a token and an email in its content never reaches the output (REQ-4)

## Phase 3: The board
- [x] Task 8: Publish `explain.md` as a document and show an "Agent run" tab with the per-phase table; decide the done-track question (REQ-6)
- [x] Task 9: The board plugin version and generated plugin, tests, strict validation; confirm no base plugin file changed (REQ-7)
- [x] Task 14 (test first): The "Agent run" tab of a track with no `explain.md` shows "No statistics yet" and a **Run statistics** button that copies the prompt of D7 (board page, add-on only) (D7)
- [ ] Task 15: The Statistics tab marks a finished track that has no `explain.md` as "no statistics recorded" (D7)
- [ ] Task 16: Board add-on version bump, regenerate, tests, strict validation; confirm no base plugin file changed (REQ-7)

## Phase 4: Use it
- [x] Task 10: Run it on 10154 and one or two other finished tracks; record the findings and the biggest inefficiencies in the spec (REQ-8)
- [x] Task 11 (HUMAN): Decide from the findings whether the lanes should run it at completion (a separate track, base text): decided, see D6 to D9 in the spec

## Phase 5: The post
- [x] Task 12: Fill "Pick Your Agent's Brain" with the real output, check every number, move it from draft to reviewed (REQ-9)
- [x] Task 13 (HUMAN): Approve and publish the post

## Phase 6: Corrections and finished tracks (2026-11-22)
- [x] Task 17 (test first): the first response of a lane run is the first message of the main session: a window where a sub-agent message comes before the main one gives the main one's context; with no main message it falls back to the sub-agent's (D10)
- [x] Task 18 (test first): the documents of finished tracks are published in shards and a finished track opens in the page with its tabs, Agent run included; the secret scan, the settings and the file limit hold; the footer says finished tracks are included (D11)
- [x] Task 19: board add-on version bump to 1.10.14, regenerate, tests, strict validation; confirm no base plugin file changed (REQ-7)
- [x] Task 20: correct the published post (D12) and deploy it, owner's word for the deploy

