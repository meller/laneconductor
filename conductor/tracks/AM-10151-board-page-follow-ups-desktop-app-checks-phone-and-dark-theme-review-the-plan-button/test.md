# Tests: AM-10151

- [ ] TC-1 (REQ-1): Move changes a lane in the desktop app and a stale edit shows CONFLICT
- [ ] TC-2 (REQ-1): Check now says up to date or out of date correctly
- [ ] TC-3 (REQ-2): no overflow at 375 px; both themes readable
- [ ] TC-4 (REQ-3): the button works or is absent by decision
- [ ] TC-5 (REQ-4): the three commands behave and nothing starts unasked
- [x] TC-6 (REQ-5): the first Stop only remembers; a pushed track change, an uncommitted shell edit and a new track folder each ask for one refresh and then stay silent; changes outside the tracks, `auto_update: false`, no stored board, a Stop already continuing and a non-git project stay silent
- [x] TC-7 (REQ-6, REQ-7): the drawer's Blocked by and KPI buttons open the right view and the Discuss prompt is plain text that runs nothing (page tests and a browser check)
- [x] TC-8 (REQ-8): after a push, `seen` makes the next Stop silent and a later change asks again; `seen` clears an Edit marker; a run without CLAUDE_PLUGIN_DATA still counts; a non-git project and a folder with no tracks break nothing; the refresh command ends with the step
- [x] TC-9 (REQ-9): a claim in the four lanes asks once and again only for a new run; other lanes, a sub-agent, auto_update false and no stored board ask nothing; the asked refresh is quiet
- [x] TC-10 (REQ-10): the add-on registers no command in any install matrix; the hook asks for the base command; the base text carries the partial procedure, the quiet rule and the seen step; every README names the one refresh command
- [x] TC-11 (REQ-11): the title is "<project> Board" (settings name, else folder; cleaned and clipped; the source page stays generic); the base text carries the match-by-project rule and never asks which one; the hook reads the main checkout's settings in a worktree and stays silent with none
