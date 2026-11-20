# Tests: AM-10153

- [ ] TC-1 (REQ-4): every claim on the README, the wiki and the landing page was checked against the code; the list of what was wrong is in the track's history
- [ ] TC-2 (REQ-1): `node scripts/make-zip.mjs` prints the file count and SHA-256 and builds the same zip twice (deterministic)
- [ ] TC-3 (REQ-1): the unzipped folder passes `claude plugin validate --strict`
- [ ] TC-4 (REQ-2): no tag was pushed and no release created without the owner's yes for each (the history lists both approvals)
- [ ] TC-5 (REQ-1): the release asset downloads and its SHA-256 equals the one in the release notes
- [ ] TC-6 (REQ-3): the landing Download button and the README route open the release asset; both say the marketplace route is the main one
- [ ] TC-7 (REQ-3): the landing page at 375 px has no horizontal overflow and the Download button is usable
- [ ] TC-8 (REQ-5): `git diff` of `landing/` before the push holds only this change
- [ ] TC-9 (REQ-6): the plugin README has one named source and the connector README matches it
