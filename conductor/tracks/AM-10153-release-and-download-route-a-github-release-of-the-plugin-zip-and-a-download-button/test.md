# Tests: AM-10153

- [ ] TC-1 (REQ-1): every claim on the README, the wiki and the landing page was checked against the code; what was wrong is listed in the track's history, and nothing says a zip, a release or the directory listing exists
- [ ] TC-2 (REQ-1): the base README no longer says hooks are not available (checked when its change ships)
- [ ] TC-3 (REQ-2): the README says no zip is published and names the marketplace one-liner as the install route (checked when its change ships)
- [ ] TC-4 (REQ-3): the plugin README has one named source and the connector README matches it
- [ ] TC-5 (REQ-4): `git diff` of `landing/` before the push holds only this track's change; after a deploy the live pages equal main
