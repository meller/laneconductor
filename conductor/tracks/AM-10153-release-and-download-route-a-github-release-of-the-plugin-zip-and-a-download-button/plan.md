# Plan: AM-10153

## Phase 1: Check before the release
- [ ] Task 1: Read the README, the wiki and the landing page against the code and the plugin manifests, claim by claim; list and fix what is wrong (REQ-4)
- [ ] Task 2: Find the one source of the plugin README (REQ-6) and write the answer in the spec
- [ ] Task 3: Dry-run `node scripts/make-zip.mjs --out <scratch dir>` and check the file count, the SHA-256 and that the zip loads (`claude plugin validate` on the unzipped folder); publish nothing

## Phase 2: The release (the owner approves each outward step)
- [ ] Task 4 (HUMAN): Say which version to release and yes to pushing the tag `v<version>` (REQ-1, REQ-2)
- [ ] Task 5 (HUMAN): Say yes to `gh release create v<version> <zip> --notes <short notes with the checksum>`
- [ ] Task 6: Check the release page: the asset downloads, its SHA-256 equals the one in the notes

## Phase 3: The Download button
- [ ] Task 7: Landing page: a Download button linking to the latest release asset, with one line on what the zip is for; README: the download route (REQ-3); check at 375 px (no horizontal overflow)
- [ ] Task 8: Check that the landing edit holds only this change (REQ-5), run the full tests, push
- [ ] Task 9 (HUMAN): Say "deploy"; then deploy from a clean copy of main and verify live
