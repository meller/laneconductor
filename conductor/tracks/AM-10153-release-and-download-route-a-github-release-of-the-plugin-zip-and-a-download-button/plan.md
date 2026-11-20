# Plan: AM-10153

## Phase 1: Find what is wrong
- [ ] Task 1: Read the README, the wiki and the landing page against the code and the plugin manifests, claim by claim; list what is wrong in the track's history (REQ-1). Start with the hooks sentence in the base README
- [ ] Task 2: Find the one source of the plugin README and write the answer in the spec (REQ-3)

## Phase 2: Fix it
- [ ] Task 3: Fix the wrong claims on the landing page and the wiki (no base file); check `git diff` of `landing/` first (REQ-4)
- [x] Task 4: The README changes (the hooks sentence, the "Other ways to get it" section removed): done 2026-11-20 on the root README; no base version needed (REQ-1, REQ-2)
- [ ] Task 5: Run the full tests and push

## Phase 3: Deploy
- [ ] Task 6 (HUMAN): Say "deploy" if the landing page or the wiki changed; then deploy from a clean copy of main and verify live
