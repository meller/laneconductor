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
- [x] Task 2.5 (HUMAN): Add laneconductor.com in Search Console as a URL-prefix property and send the agent the verification file or meta tag (no DNS record needed); the agent adds it, and after the deploy the owner verifies and submits the sitemap
- [x] Task 2.6 (HUMAN): Say "deploy"; then deploy from a clean worktree of main and verify live (tool receives a visit; events fire)

## Phase 3: First campaign (the demo post)

- [ ] Task 3.1: Kit: a short demo of the first run (install, `go`, the board) as a recording or a few screenshots, the post text in the owner's voice, and a tagged link (`?src=<channel>`)
- [x] Task 3.2: Decided 2026-11-25 (owner: "let's do 3.2 with post 9"): channel = the owner's LinkedIn profile, with post 9 (stop-guessing-what-your-agent-is-doing) and the tagged link ?src=post-9; run window = 14 days from the owner's "posted"; baseline on 2026-11-25 = 14 stars, 3 forks, 1 watcher, 2,702 clones in 14 days (540 unique); kill rule = if fewer than 5 new stars after 14 days (stars 19 or more is a pass), stop and close the campaign with the reason, and do not repeat the same post on this channel; N = 5 is the assistant's proposal that the owner accepted by not changing it and can change before the window starts. Later replies use their own tags (post-9-reply, post-11-reply) and are not part of this window.
- [x] Task 3.3 (HUMAN): Post it and say "posted"; the agent records the link and sets the run window Posted 2026-11-25 about 12:18Z on the owner's LinkedIn (https://www.linkedin.com/feed/update/urn:li:ugcPost:7393914228010565632/), tagged link ?src=post-9. Window: 14 days, 2026-11-25 to 2026-12-09; readout (task 3.4) on 2026-12-09.
- [ ] Task 3.4: Readout at the end of the window: stars, tagged visits, button events, what was learned, the next campaign; close the campaign with the reason

## Phase 4: After the directory listing

- [ ] Task 4.1: When track 10148 lists the plugin, add the directory's Usage-tab install count to the weekly line and to the KPI
- [ ] Task 4.2: Write the readout for the KPI date (2026-12-17): stars per week and directory installs against the baseline; set `Result` and close the track, or plan the next campaign
