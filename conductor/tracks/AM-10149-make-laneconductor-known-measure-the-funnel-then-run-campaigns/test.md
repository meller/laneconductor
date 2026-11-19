# Tests: AM-10149

Run command: `curl`, `gh api` and a browser check of the live site; no code in the plugins changes.

- [ ] TC-1 (REQ-1): history.md has a dated snapshot line for each week since 2026-11-19, with stars, forks, unique clones, unique views and referrers
- [ ] TC-2 (REQ-2): the live site sets no cookie (check in the browser's storage) and the analytics tool receives a visit and each of the named button events
- [ ] TC-3 (REQ-2): docs/privacy.md and the plugins' text still say the plugins have no analytics, and the site names what it counts in one sentence
- [ ] TC-4 (REQ-3): `curl https://laneconductor.com/sitemap.xml` and `/robots.txt` return the real files, not the home page; Search Console shows the site verified and the sitemap read
- [ ] TC-5 (REQ-4): the first campaign has a kit, a named owner action with a due date, a run window and a kill rule written before it starts, and its readout closes it with a reason
- [ ] TC-6 (REQ-5): every number on the site, README and posts that comes from this track is in a snapshot line or a readout; a search for unsupported numbers finds none
- [ ] TC-7 (REQ-6): no deploy or post happened before the owner said so (the history shows the owner's word for each)
- [ ] TC-8: after the listing, the directory's Usage-tab count is in the weekly line
