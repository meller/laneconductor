# Tests: AM-10154

- [ ] TC-1 (REQ-3): `node skills-tools/bin/check.mjs` reports zero errors and zero warnings for the library with the two new skills
- [ ] TC-2 (REQ-3): `node skills-tools/bin/gate.mjs` with the local deny list reports zero findings; a grep of the new folders finds no email, project id, bucket name or local path
- [ ] TC-3 (REQ-1, REQ-2, REQ-4): every claim in each skill is confirmed against Google's documentation or the observed code, or sits under Unproven; nothing from another repository was run
- [ ] TC-4 (REQ-5): the pack tests list the pack with three skills and the skill count is right; `node scripts/build-plugin.mjs --check` is clean
- [ ] TC-5 (REQ-5): strict validation passes for the pack and the repository; no base plugin file changed (`git diff` of the base plugin is empty)
- [ ] TC-6 (REQ-5): a fresh `CLAUDE_CONFIG_DIR` installs `laneconductor-analytics-monitoring@laneconductor` from GitHub and `claude plugin details` lists three skills
- [ ] TC-7 (REQ-5): the root README, the landing page and the wiki list the pack with its monitoring and logging skills; after a deploy the live pages equal main
- [ ] TC-8 (REQ-1, REQ-2): each skill body is at most 8,000 characters and has the sections in the library order (Why this works, Recommendation, Claude does, You run, Pitfalls, Unproven); the monitoring skill has a budget-alert section (D4) and no `files/` folder (D2, D3)

## Test Commands
- `(cd skills-tools && npm ci)` once, then `node skills-tools/bin/check.mjs`
- `node skills-tools/bin/gate.mjs --deny-file ~/Code/homebrew-skills-public/.homebrew-deny.local.txt`
- `node scripts/build-plugin.mjs --check`, `npm test` (look for `# fail 0`), `claude plugin validate . --strict` as in the 10114 gate
