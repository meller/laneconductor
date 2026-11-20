# Tests: AM-10153

- [ ] TC-1 (REQ-6): every claim on the README, the wiki and the landing page was checked against the code; what was wrong is listed in the track's history
- [ ] TC-2 (REQ-3): `make-zip.mjs` builds the same bytes twice; the unzipped folder passes `claude plugin validate --strict`; `claude --plugin-dir <zip>` loads it
- [ ] TC-3 (REQ-1, REQ-2): the repository test on the workflow passes: triggers, minimal permissions, `GITHUB_TOKEN` only, pinned actions, the fixed file name, `--clobber`, the drift check and `make-zip.mjs` are used
- [ ] TC-4 (REQ-1): after the owner's yes and the push, the first run is green and the `latest` release holds one asset, `laneconductor.zip`
- [ ] TC-5 (REQ-5): the asset downloads from `https://github.com/meller/laneconductor/releases/download/latest/laneconductor.zip` and its SHA-256 equals the one in the notes
- [ ] TC-6 (REQ-1): a later push that changes the base plugin replaces the asset (the notes show the new version, commit and SHA-256); a push that changes only the site does not run the workflow
- [ ] TC-7 (REQ-4): the landing Download button and the README route open the asset; both say the marketplace route is the main one and the zip does not update itself
- [ ] TC-8 (REQ-4): the landing page at 375 px has no horizontal overflow and the Download button is usable
- [ ] TC-9 (REQ-7): `git diff` of `landing/` before the push holds only this change
- [ ] TC-10 (REQ-8): the plugin README has one named source and the connector README matches it
