# Plan: AM-10151

- [ ] Task 1 (HUMAN): in the desktop app, use the Move menu and Check now on the live board; record what happens (REQ-1)
- [ ] Task 2: Fix the server string or remove the controls according to Task 1 (REQ-1)
- [ ] Task 3 (HUMAN): look at the board at 375 px and in light and dark (REQ-2)
- [ ] Task 4: Decide whether to build the Review-the-plan button; if yes, build and test it (REQ-3)
- [ ] Task 5 (HUMAN): `/laneconductor:status`, `:plan` and `:run` on a scratch repository (REQ-4)
- [x] Task 6: The Stop hook fingerprints the tracks so a change by any tool asks for a refresh (REQ-5; board 1.10.4; tests in `board-hooks.test.mjs`)
- [x] Task 7: Blocked-by links, the KPI link and the Discuss button in the drawer (REQ-6, REQ-7; board 1.10.3)
- [x] Task 8: The hook's `seen` step and the refresh command's last step (REQ-8; board 1.10.8; tests H5 in `board-hooks.test.mjs`)
- [x] Task 9: The lane-start refresh and the quiet refresh (REQ-9; board 1.10.9; tests H6 in `board-hooks.test.mjs`)
