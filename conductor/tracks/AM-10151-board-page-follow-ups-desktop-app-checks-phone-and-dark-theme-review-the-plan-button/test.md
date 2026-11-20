# Tests: AM-10151

- [ ] TC-1 (REQ-1): Move changes a lane in the desktop app and a stale edit shows CONFLICT
- [ ] TC-2 (REQ-1): Check now says up to date or out of date correctly
- [ ] TC-3 (REQ-2): no overflow at 375 px; both themes readable
- [ ] TC-4 (REQ-3): the button works or is absent by decision
- [ ] TC-5 (REQ-4): the three commands behave and nothing starts unasked
- [x] TC-6 (REQ-5): the first Stop only remembers; a pushed track change, an uncommitted shell edit and a new track folder each ask for one refresh and then stay silent; changes outside the tracks, `auto_update: false`, no stored board, a Stop already continuing and a non-git project stay silent
- [x] TC-7 (REQ-6, REQ-7): the drawer's Blocked by and KPI buttons open the right view and the Discuss prompt is plain text that runs nothing (page tests and a browser check)
