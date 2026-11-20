# Plan: AM-10153

## Phase 1: Check before the workflow
- [ ] Task 1: Read the README, the wiki and the landing page against the code and the plugin manifests, claim by claim; list and fix what is wrong (REQ-6)
- [ ] Task 2: Find the one source of the plugin README and write the answer in the spec (REQ-8)
- [ ] Task 3: Dry-run `node scripts/make-zip.mjs --out <scratch>/laneconductor.zip` twice (same bytes), unzip it, run `claude plugin validate --strict` on the folder and `claude --plugin-dir <zip>` in a scratch session; publish nothing (REQ-3, REQ-5)

## Phase 2: The workflow
- [ ] Task 4: Write `.github/workflows/plugin-zip.yml` (REQ-1, REQ-2): triggers, Node 20, the drift check, the zip, the SHA-256, the `latest` release with `--clobber`, the notes
- [ ] Task 5: A repository test that reads the workflow and checks the triggers, `contents: write` only, `GITHUB_TOKEN` only, no other secret, the actions pinned, the stable file name, `--clobber`, and that it calls `make-zip.mjs` and the drift check
- [ ] Task 6 (HUMAN): Say yes to pushing the workflow: it is a standing automation that publishes to the repository's releases (REQ-1)
- [ ] Task 7: Push it; watch the first run (`gh run watch`); check the release page, the stable address, the SHA-256 against the notes, and the unzipped folder (REQ-5)

## Phase 3: The Download button
- [ ] Task 8: Landing page: a Download button to the stable address with one line on what the zip is for; README: the same route (REQ-4); check at 375 px (no horizontal overflow)
- [ ] Task 9: Check that the landing edit holds only this change (REQ-7); run the full tests; push
- [ ] Task 10 (HUMAN): Say "deploy"; then deploy from a clean copy of main and verify live
