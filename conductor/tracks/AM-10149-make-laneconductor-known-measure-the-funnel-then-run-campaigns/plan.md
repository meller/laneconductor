# Plan: AM-10149

## Phase 1: Baseline and snapshots

- [x] Task 1.1: Read the baseline with `gh api` (stars, forks, watchers, clones, views, referrers) and record it in the spec (2026-11-19)
- [ ] Task 1.2: Weekly snapshot: run `gh api repos/meller/laneconductor/traffic/clones`, `.../traffic/views`, `.../traffic/popular/referrers` and the repository's star and fork counts, and append one dated line to history.md (every week; ask `next` to be reminded; GitHub keeps only 14 days)
- [ ] Task 1.3: Check whether a `git fetch` or plugin update shows in the clone count (compare the day's count before and after one update) and write the answer in the spec

## Phase 2: Measure the site

- [ ] Task 2.1 (HUMAN): Choose the analytics tool and create its account; tell the agent the site id
- [ ] Task 2.2: Add the script to landing/index.html and landing/wiki.html, and the events: copy-install click, GitHub button click, "Read the full comparison" click, wiki click
- [ ] Task 2.3: One sentence on the site saying what is counted (page views and those clicks, no cookies, no personal data), after checking the tool's own behaviour
- [ ] Task 2.4: Add real `landing/sitemap.xml` and `landing/robots.txt` (the hosting rewrite returns the home page for both today); check with curl after deploy
- [ ] Task 2.5 (HUMAN): Verify laneconductor.com in Search Console (DNS record) and submit the sitemap
- [ ] Task 2.6 (HUMAN): Say "deploy"; then deploy from a clean worktree of main and verify live (tool receives a visit; events fire)

## Phase 3: First campaign (the demo post)

- [ ] Task 3.1: Kit: a short demo of the first run (install, `go`, the board) as a recording or a few screenshots, the post text in the owner's voice, and a tagged link (`?src=<channel>`)
- [ ] Task 3.2: Decide before it starts: the channel, the run window (14 days) and the kill rule (for example: stop after 14 days if fewer than N new stars; N chosen by the owner from the baseline)
- [ ] Task 3.3 (HUMAN): Post it and say "posted"; the agent records the link and sets the run window
- [ ] Task 3.4: Readout at the end of the window: stars, tagged visits, button events, what was learned, the next campaign; close the campaign with the reason

## Phase 4: After the directory listing

- [ ] Task 4.1: When track 10148 lists the plugin, add the directory's Usage-tab install count to the weekly line and to the KPI
- [ ] Task 4.2: Write the readout for the KPI date (2026-12-17): stars per week and directory installs against the baseline; set `Result` and close the track, or plan the next campaign
