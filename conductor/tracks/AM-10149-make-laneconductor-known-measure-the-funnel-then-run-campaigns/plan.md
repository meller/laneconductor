# Plan: AM-10149

## Phase 1: Baseline and snapshots

- [x] Task 1.1: Read the baseline with `gh api` (stars, forks, watchers, clones, views, referrers) and record it in the spec (2026-11-19)
- [x] Task 1.2 (first one 2026-11-20; repeat every week): Weekly snapshot: run `gh api repos/meller/laneconductor/traffic/clones`, `.../traffic/views`, `.../traffic/popular/referrers` and the repository's star and fork counts, and append one dated line to history.md (every week; ask `next` to be reminded; GitHub keeps only 14 days)
- [ ] Task 1.3: Check whether a `git fetch` or plugin update shows in the clone count (compare the day's count before and after one update) and write the answer in the spec

## Phase 2: Measure the site

- [x] Task 2.1 (HUMAN): Analytics tool chosen: Google Analytics 4. Create the property and web stream (or link it through the Firebase project) and tell the agent the measurement id
- [x] Task 2.2: Add the Google tag to landing/index.html and landing/wiki.html after a consent notice (the Otralingo pattern, ads features off), and the events: copy-install click, GitHub button click, "Read the full comparison" click, wiki click (prepared 2026-11-25 as landing/analytics.js, loaded by index, wiki and the two posts and the posts index; the measurement id is empty until task 2.1, so it does nothing yet; live check is 2.6)
- [x] Task 2.3: One sentence on the site saying what is counted (page views and those clicks, only after the visitor accepts; no ads features), after checking the tool's own behaviour (footer sentence #analytics-note in landing/index.html, shown only once an id is set; not deployed)
- [x] Task 2.4: Real `landing/sitemap.xml` and `landing/robots.txt` added 2026-11-20 with a test (not deployed; a file is served before the catch-all rewrite); check with curl after the deploy
- [ ] Task 2.5 (HUMAN): Add laneconductor.com in Search Console as a URL-prefix property and send the agent the verification file or meta tag (no DNS record needed); the agent adds it, and after the deploy the owner verifies and submits the sitemap
- [ ] Task 2.6 (HUMAN): Say "deploy"; then deploy from a clean worktree of main and verify live (tool receives a visit; events fire)

## Phase 3: First campaign (the demo post)

- [ ] Task 3.1: Kit: a short demo of the first run (install, `go`, the board) as a recording or a few screenshots, the post text in the owner's voice, and a tagged link (`?src=<channel>`)
- [ ] Task 3.2: Decide before it starts: the channel, the run window (14 days) and the kill rule (for example: stop after 14 days if fewer than N new stars; N chosen by the owner from the baseline)
- [ ] Task 3.3 (HUMAN): Post it and say "posted"; the agent records the link and sets the run window
- [ ] Task 3.4: Readout at the end of the window: stars, tagged visits, button events, what was learned, the next campaign; close the campaign with the reason

## Phase 4: After the directory listing

- [ ] Task 4.1: When track 10148 lists the plugin, add the directory's Usage-tab install count to the weekly line and to the KPI
- [ ] Task 4.2: Write the readout for the KPI date (2026-12-17): stars per week and directory installs against the baseline; set `Result` and close the track, or plan the next campaign
