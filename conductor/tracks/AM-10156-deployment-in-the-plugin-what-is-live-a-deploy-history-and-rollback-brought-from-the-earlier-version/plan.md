# Plan: AM-10156

## Phase 1: Probe and decide
- [x] Task 1: Read the earlier runner, config and docs (tag `v1-legacy`) and the backlog tracks 1065 and 1097; list what to bring and what stays in the tag
- [x] Task 2 (HUMAN): Settle the decisions of the spec with the owner: record format and place, rollback strategies, command shape (confirmed 2026-11-22, D1, D2, D4, D9, D10)
- [x] Task 3: Write the settled decisions into the spec with their dates (proposed defaults D1 to D8, confirmed in task 2)

## Phase 2: Records and status
- [x] Task 4 (test first): the record format and a writer rule in the base `deploy` text; a synthetic project with two records answers `status` correctly (REQ-1, REQ-2)
- [x] Task 5: `deploy status` (local build version, last record, live version, drift) and `deploy history` (the list of versions) in the base text, read only (REQ-2, REQ-3b, D10)

## Phase 3: Rollback
- [x] Task 6 (test first): the rollback text with the choice of version (`rollback [env] [version]`, a list when none is given), the optional `rollback`, `service`, `version` and `liveVersionUrl` keys of `deploy.json` (D3, D9, D10), the default redeploy-the-previous-commit strategy and the provider hints; the yes gate names the environment and command; no reset or force push (REQ-3, REQ-7)

## Phase 4: Failure recovery and release notes
- [x] Task 7: the failure-recovery steps in the base text (REQ-4)
- [x] Task 8: "shipped since the last deploy" from the finished tracks (REQ-5)

## Phase 5: The board
- [x] Task 9 (test first): the Deployment tab shows live version, time, result, history and a Copy button for the next step (REQ-6)

## Phase 6: Use it for real
- [ ] Task 10: add a `version.json` (commit and time) to the deploy copy of this site at deploy time, write the records for this site's production hosting deploys and check `status` and the rollback prompt against the live site (no rollback is executed)
- [ ] Task 11 (HUMAN): the owner reads the texts, and approves one base release (REQ-8)
