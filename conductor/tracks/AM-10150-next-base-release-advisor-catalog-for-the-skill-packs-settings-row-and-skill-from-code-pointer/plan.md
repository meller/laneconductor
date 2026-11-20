# Plan: AM-10150

## Phase 1: Wait for the directory decision (track 10148)

- [ ] Task 1: Check the portal; when the base is approved, rejected or a reviewer asks for changes, start Phase 2 (a requested change goes into the same release)

## Phase 2: The base release

- [ ] Task 2: Catalog entries for the four stack packs, the stack tags `postgres` and `gemini` and their detection markers (REQ-1)
- [ ] Task 3: The `skill-from-code` pointer in `suggest-skills` (REQ-2)
- [ ] Task 4: The `board.auto_update` row in `ops/settings.md` (REQ-3)
- [ ] Task 4b: The `board` command creates a missing board without a second question, with the privacy facts said afterwards (`board` command text, `ops/board.md` step 3b, `ops/settings.md`) (REQ-6)
- [ ] Task 5: Pay for the added text so the ceilings hold (REQ-4); run the tests
- [ ] Task 6: Release with the base version knob; validate strict and the directory profile; tell the owner first (REQ-5)

## Phase 3: Owner steps and discovery

- [ ] Task 7 (HUMAN): add the `agent-skill` topic to the GitHub repository
- [ ] Task 8: With the owner's yes, run `npx skills add meller/laneconductor --list` and record whether it finds the skills; optionally submit to the submit-form directories
- [ ] Task 9: Update the README and the site with what changed (deploy only on the owner's word)
