# Tests: Track 10148 (directory submission)

Run command: `cd connector && npm test`, `node scripts/build-plugin.mjs --check`, `claude plugin validate --strict plugins/laneconductor` and `claude plugin validate --profile directory plugins/laneconductor`, `node scripts/check-catalog.mjs --online`. HUMAN cases are run by the owner.

- [ ] TC-1 (REQ-1): on the version to submit, all of the above pass, the base folder holds no script, package file, `.mcp.json` or `isolation` key, and `directory-base.test.mjs` passes
- [ ] TC-2 (REQ-1): the README, licence, icon and privacy page exist and the privacy, homepage and repository URLs answer 200
- [ ] TC-3 (HUMAN) (REQ-2): `/laneconductor:setup` and `/laneconductor:next` in a real project show no read-outside-the-working-directories prompt
- [ ] TC-4 (HUMAN) (REQ-3): the portal's Validate on the current base has no blocking item; the result is pasted in the plan with the date and version
- [ ] TC-5 (REQ-4): the drafted answers match the plugin's behaviour (a reader can check each sentence against the repository) and make no claim the plugin does not meet
- [ ] TC-6 (REQ-6): every reviewer comment has a row in the review log with an answer or a fix and the version that shipped it
- [ ] TC-7 (HUMAN) (REQ-7): in a clean profile the base installs from the directory, and setup and next work; recorded
- [ ] TC-8 (REQ-7): no README, website or doc text says the plugin is listed before TC-7 is recorded (a search of the repository finds none)
