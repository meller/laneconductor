# Tests: Track 10114 - Docs and landing page: the plugin, the board, and the new direction

This is a docs track, so the tests are checks of text and pages. Run them from the repository root; each grep must print the matching lines (or, for the negative checks, nothing). Cases marked (human) need a person's judgement. All cases are derived from the spec's acceptance criteria; none was run as an automated suite.

- [x] TC-1 (REQ-1): the README says the older stack is experimental and currently unmaintained and that the plugin does not need it. `grep -n -i "experimental" README.md`
- [ ] TC-2 (REQ-1, human): product.md, tech-stack.md, the wiki and the landing page call the daemon and Postgres tier "experimental, currently unmaintained" and never "legacy" (only the literal tag name v1-legacy). `grep -n -i "legacy" conductor/product.md conductor/tech-stack.md landing/index.html landing/wiki.html`. Not met today: product.md and wiki.html say "Legacy tier".
- [x] TC-3 (REQ-2): the install commands appear in the README and on the landing page. `grep -n "claude plugin marketplace add meller/laneconductor" README.md landing/index.html conductor/tech-stack.md`
- [x] TC-4 (REQ-2): the README names `--scope local`, `--scope user`, `claude plugin list`, `/mcp` and the update commands. `grep -n -e "--scope" -e "plugin list" -e "marketplace update" README.md`
- [x] TC-5 (REQ-2, REQ-9): the README and the landing page say what is not available yet (no release zip, remote connector for chat and mobile, directory listing). `grep -n -i "no release zip" README.md` and `grep -n -i "not yet available" landing/index.html`
- [x] TC-6 (REQ-3): the README has the migration steps (install, confirm the connector, remove the old skill link, stop the worker). `grep -n -i "earlier install" README.md`, then read the numbered steps that follow.
- [x] TC-7 (REQ-4): the README board section names the private artifact, "update the board", the snapshot and the privacy scan with what is withheld. `grep -n -i "withheld\|snapshot\|update the board" README.md`
- [x] TC-8 (REQ-6, REQ-7): the README names conflict checks, the state branch order, no pushes without asking, `conversation.md` per machine and the advice log. `grep -n -i "CONFLICT\|State branch\|conversation.md\|Advice log" README.md`
- [ ] TC-9 (REQ-1, REQ-4, REQ-7): no stale `lc` command or `make install` remains on a page that describes the current product. `grep -n "make install\|lc setup\|lc board\|lc start\|lc worker" README.md landing/index.html landing/wiki.html`. Not met today: landing/wiki.html still has `lc board` in its board section and `lc setup` / `lc start` in the older sections.
- [ ] TC-10 (REQ-10): the landing page has a Download button linking to a published release, and the README download route links to it. Not testable until a release is published.
- [ ] TC-11 (REQ-10, human): the release steps (version bump, zip, checksum, tag, `gh release create`) are done with the human approving each outward step.
- [ ] TC-12 (REQ-11): connector/README.md and the plugin README stay in sync from the one source file. Not verified (the source file was not found).
- [x] TC-13 (REQ-8, human): the landing page renders on a phone-width screen with the install box usable, and in its theme(s). Checked live 2026-11-20 at 375 px: no horizontal overflow, install box 343 px wide with its Copy button; the page has one dark theme only.
- [ ] TC-14 (REQ-9, human): every claim on the README, the wiki and the landing page is checked against the current code and plan; no unmeasured number or screenshot. A person reads the pages against the code.
- [ ] TC-15 (REQ-8, human): the landing edits do not include another track's uncommitted drafts (check `git diff` of landing/ before any deploy).
