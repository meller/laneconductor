# Tests: AM-10156

## Test Commands
- `cd connector && npm test` (look for `# fail 0`); `node scripts/build-plugin.mjs --check`; `claude plugin validate . --strict`

## Test Cases
- [ ] TC-1 (REQ-1): the `deploy` text tells Claude to write a record per run with every field of REQ-1 and never a secret; a lint test refuses a record with a token-shaped value
- [ ] TC-2 (REQ-2): a synthetic project with records for two environments gives the right live version, age and commits-ahead from the records alone
- [ ] TC-3 (REQ-3, REQ-7): the rollback text names the previous good record and the exact command, waits for a yes that names environment and command, and contains no reset or force push
- [ ] TC-4 (REQ-4): a failed deploy log leads to the failed step being named and only that step re-run after a yes
- [ ] TC-5 (REQ-5): the release notes list exactly the tracks finished since the previous good record
- [ ] TC-6 (REQ-6): in the board page, the Deployment tab shows the live version, history and the Copy button for deploy and rollback
- [ ] TC-7 (REQ-8): the base plugin has no script added; its commands stay under the size limits; strict validation passes

## Acceptance Criteria
- [ ] After a deploy, `status` says what is live in each environment, which version and since when
- [ ] A rollback shows exactly what it will do and runs only on the owner's yes
- [ ] The board shows the history; no secret appears in any record or on the board
