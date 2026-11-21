# Plan: AM-10155

## Phase 1: Probe the data
- [ ] Task 1: Repeat the probe of the spec's "Probe findings" on a plain CLI session and on a worktree session, and write down what differs (REQ-1, REQ-3)
- [ ] Task 2: Settle the two open questions in the spec and fold the answers into the decisions D1 to D5

## Phase 2: The script
- [ ] Task 3 (test first): Boundaries from the track files and git: lane runs and phases with their start and end (REQ-2)
- [ ] Task 4: Attribute transcript messages to a lane or phase by time window and working directory; active versus waiting time (REQ-2, REQ-3)
- [ ] Task 5: Token split, tool calls by kind, slowest steps, sub-agent share, repeated reads as counts (REQ-3)
- [ ] Task 6: Write `explain.md` (generated, overwritten, with its sources and time) and print the same table (REQ-1, REQ-5)
- [ ] Task 7: The privacy test: a transcript with a token and an email in its content never reaches the output (REQ-4)

## Phase 3: The board
- [ ] Task 8: Publish `explain.md` as a document and show an "Agent run" tab with the per-phase table; decide the done-track question (REQ-6)
- [ ] Task 9: The board plugin version and generated plugin, tests, strict validation; confirm no base plugin file changed (REQ-7)

## Phase 4: Use it
- [ ] Task 10: Run it on 10154 and one or two other finished tracks; record the findings and the biggest inefficiencies in the spec (REQ-8)
- [ ] Task 11 (HUMAN): Decide from the findings whether the lanes should run it at completion (a separate track, base text)

## Phase 5: The post
- [ ] Task 12: Fill "Pick Your Agent's Brain" with the real output, check every number, move it from draft to reviewed (REQ-9)
- [ ] Task 13 (HUMAN): Approve and publish the post
