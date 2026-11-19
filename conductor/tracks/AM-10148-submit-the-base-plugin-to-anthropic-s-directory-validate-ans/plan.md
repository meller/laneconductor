# Track 10148: Submit the base plugin to Anthropic's directory (validate, answers, review loop)

The design is in spec.md. Split out of track 10128, Phase 7. The owner submits.

## Phase 1: Before the portal

- [x] Task 1: Name the version to submit (the current release of the base) and run the local checks of REQ-1 on it; record the results here. Version 1.9.1 (main 70d8c053), 2026-11-19: 769 of 769 connector tests, drift check clean, `claude plugin validate --strict` and the directory profile pass on plugins/laneconductor, the catalog resolves online (12 entries), README, LICENSE and icon present, no script, package file, .mcp.json or isolation key in the base, the privacy page, the homepage and the repository answer 200.
- [x] Task 2 (HUMAN): the real-session setup and next check of track 10132 (no "Allow reads outside the working directories" prompt); record the result. Done 2026-11-19 headlessly (the owner's suggestion) on a scratch copy of a real project: no read-outside denial; a chained Bash denial in next on 1.9.0 was fixed in 1.9.1.
- [x] Task 3: Draft the answers of REQ-4 (the two earlier reviewer holds and the data-handling questions) from the plugin's real behaviour, for the owner to read and edit. Written in spec.md, section "Draft answers for the portal"; they need the portal's exact wording to be matched

## Phase 2: The portal's Validate

- [x] Task 1 (HUMAN): run the portal's Validate on the current base; paste the blocking items, warnings and reviewer holds here with the date and version. Done 2026-11-19 in the owner's browser at the owner's request: passed, 1 warning (privacyPolicyUrl, no action), 2 policy holds, nothing blocking; the full result is in spec.md, section "Portal Validate result"
- [x] Task 2: Fix every blocking item (a task each), re-release if the plugin changes, and repeat Task 1 until none blocks. There is no blocking item; the two holds are for a reviewer to release (optional: remove the `.vercel` line from the deploy guide's .gitignore list, which Vercel's own CLI adds itself, to try to clear hold 1)

## Phase 3: Submit

- [ ] Task 1 (HUMAN): the owner answers the data-handling questions, ticks the acknowledgements and submits

## Phase 4: Review loop

- [ ] Task 1: Keep the review table in this plan's spec section "Review log" (date, comment, answer or fix, version); one task per change a reviewer asks for
- [ ] Task 2: If size is raised, do task 8.7 of track 10128 (trim the carried command text) and answer 8.8

## Phase 5: After the listing

- [ ] Task 1 (HUMAN): in a clean profile with no marketplace of ours, install the base from the directory, run setup and next, record the result
- [ ] Task 2: Only now update the README and the website to mention the directory install (the website is deployed only when the owner says deploy)

**Impact**: The base plugin is discoverable in Anthropic's directory, with each reviewer comment answered and the version that fixed it on record.
