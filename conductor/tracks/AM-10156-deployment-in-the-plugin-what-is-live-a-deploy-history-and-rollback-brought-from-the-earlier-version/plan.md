# Plan: AM-10156

## Phase 1: Probe and decide
- [ ] Task 1: Read the earlier runner, config and docs (tag `v1-legacy`) and the backlog tracks 1065 and 1097; list what to bring and what stays in the tag
- [ ] Task 2 (HUMAN): Settle the decisions of the spec with the owner: record format and place, rollback strategies, command shape
- [ ] Task 3: Write the settled decisions into the spec with their dates

## Phase 2: Records and status
- [ ] Task 4 (test first): the record format and a writer rule in the base `deploy` text; a synthetic project with two records answers `status` correctly (REQ-1, REQ-2)
- [ ] Task 5: `deploy status` in the base text (read only) (REQ-2)

## Phase 3: Rollback
- [ ] Task 6 (test first): the rollback text and the `rollback` key of `deploy.json`; the yes gate names the environment and command; no reset or force push (REQ-3, REQ-7)

## Phase 4: Failure recovery and release notes
- [ ] Task 7: the failure-recovery steps in the base text (REQ-4)
- [ ] Task 8: "shipped since the last deploy" from the finished tracks (REQ-5)

## Phase 5: The board
- [ ] Task 9 (test first): the Deployment tab shows live version, time, result, history and a Copy button for the next step (REQ-6)

## Phase 6: Use it for real
- [ ] Task 10: write the records for this site's production hosting deploys and check `status` and the rollback prompt against the live site (no rollback is executed)
- [ ] Task 11 (HUMAN): the owner reads the texts, and approves one base release (REQ-8)
