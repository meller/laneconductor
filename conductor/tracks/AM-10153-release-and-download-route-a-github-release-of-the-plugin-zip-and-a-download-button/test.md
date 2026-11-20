# Tests: AM-10153

- [~] TC-1 (dropped at close) (REQ-1): every claim on the README, the wiki and the landing page was checked against the code; what was wrong is listed in the track's history, and nothing says a zip, a release or the directory listing exists
- [x] TC-2 (REQ-1): the README no longer says hooks are not available (checked 2026-11-20)
- [x] TC-3 (REQ-2): the README has no zip section (`grep -i zip README.md` finds none; checked 2026-11-20)
- [~] TC-4 (dropped at close) (REQ-3): the plugin README has one named source and the connector README matches it
- [~] TC-5 (dropped at close) (REQ-4): `git diff` of `landing/` before the push holds only this track's change; after a deploy the live pages equal main
