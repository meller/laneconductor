# Tests: Track 10129 - Public, generic version of the homebrew skills: no private names, paths, repos or commits

Proposed test plan, derived from the acceptance criteria; no test exists yet. Run in `~/Code/homebrew-skills-public` (outside this repository): the library's own checker and privacy gate under `tools/` (run its tests with `cd tools && npm test`), the searches below, and `claude plugin validate --strict`.

- [ ] TC-1 (REQ-4): the privacy gate with the local deny list reports zero findings on the whole tree.
- [ ] TC-2 (REQ-4): `grep -rn '/home/'` finds nothing.
- [ ] TC-3 (REQ-4): every github.com URL in the tree is github.com/meller/laneconductor.
- [ ] TC-4 (REQ-4): a search for 7-to-40 hex-character strings finds no commit-like string.
- [ ] TC-5 (REQ-4): a search for email addresses finds nothing.
- [ ] TC-6 (REQ-4): a search for ports and hosts finds none that identify a private service.
- [ ] TC-7 (REQ-3): the checker accepts a skill with no references; its own tests still pass.
- [ ] TC-8 (REQ-2): all 13 skills are present, each with `verified` as a date and the statement "observed in the author's own projects with LaneConductor", and no `references` entry naming a private repository.
- [ ] TC-9 (REQ-5): the README states what it is, install and update commands, how to attach skills to lanes in `conductor/workflow.json`, and the license.
- [ ] TC-10 (REQ-6): `git rev-list --count HEAD` is 1 in `~/Code/homebrew-skills-public`.
- [ ] TC-11 (REQ-6): `claude plugin validate --strict` passes on the plugin and on the marketplace.
- [ ] TC-12 (REQ-1): the deny list file is not part of the repository (ignored or outside the tree) and was built without reading any `.env` or credential file.
- [ ] TC-13 (REQ-7): the report lists the removals by category and counts and names what lost value.
