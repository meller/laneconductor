# Tests: Track 10126 - Homebrew skills: turn the recipe library into the owner's own skills marketplace

All cases run in the library repository, not in this one. Commands, from `~/Code/lc-recipes`: `claude plugin validate . --strict`; `node tools/bin/check.mjs` (the checker, with the secret scan and the reference resolver); `node tools/bin/gate.mjs` (the deny-list privacy gate); and `cd tools && npm test` (`node --test test/tools.test.mjs`, 5 tests). Only the tools have a test file; the other cases are commands and inspections.

- [x] TC-1 (REQ-1): `.claude-plugin/plugin.json` and `marketplace.json` are named `homebrew-skills`, version 0.2.0; the README gives the install and update commands
- [x] TC-2 (REQ-2, REQ-3): `grep -rn "find_recipe\|get_recipe\|bootstrap_project\|save_recipe" skills` finds nothing; `skills/new-project` does not exist; `skills/capture-solved-problem` does
- [x] TC-3 (REQ-4): the five new skills exist and each has a reference and a verified date in its metadata
- [x] TC-4 (REQ-5): `cd tools && npm test` passes (5 tests); `.homebrew-deny.local.txt` is git-ignored
- [x] TC-5 (REQ-7): `claude plugin validate . --strict` passes; the checker reports 0 errors on all 13 skills
- [x] TC-6 (REQ-6): the README has the section "Use with LaneConductor"
- [x] TC-7 (REQ-7): `git remote -v` prints nothing and `git status --short` is empty
- [ ] TC-8 (REQ-7): the checker reports no findings, not even warnings (currently 1 warning, a stale reference)
- [ ] TC-9 (REQ-5, REQ-7): `node tools/bin/gate.mjs` against the owner's local deny list reports no hit (not run)
- [ ] TC-10 (HUMAN): install the library from its marketplace (`claude plugin marketplace add ~/Code/lc-recipes`, then `claude plugin install homebrew-skills@homebrew-skills`) and try one skill in a real session
