# Spec: Make LaneConductor known (AM-10149)

## Goal

No money is involved, so "popular" means: more people find LaneConductor, install it and run a first track. We know almost nothing about that today. This track makes it measurable without adding any telemetry to the plugin, then runs campaigns and reads their result.

## KPI

**GitHub stars per week, plus installs shown on the directory's Usage tab once the plugin is listed** (track 10148). Both are visible without anything from us on the user's machine. First readout on `KPI Check After` (2026-12-17, four weeks from the baseline), then weekly in this track's history.

Supporting numbers (not the KPI): unique cloners, unique page views and referrers from GitHub traffic; forks and watchers; site visits and the two button events once analytics exists; search impressions from Search Console.

## Baseline (read 2026-11-19 with `gh api`; GitHub traffic covers the 14 days to 2026-11-18)

- Stars 14, forks 3, watchers 1, open issues 0, releases 0 (installs come from the marketplace, not release downloads).
- Clones in 14 days: 464, from 128 unique cloners (spikes on 2026-11-17: 105 clones, 17 unique; 2026-11-18: 288 clones, 82 unique, around the 1.9.x releases). Adding the marketplace clones the repository, so clones include installs, but also bots, mirrors, scanners and our own runs: an upper bound, never a count of users.
- Page views in 14 days: 8, from 8 unique visitors. Referrers: one (aocr.org, 2 visits).
- GitHub keeps traffic for 14 days only, so a weekly snapshot must be saved or the trend is lost.

## What we can and cannot know

- The plugin has no telemetry and never will (docs/privacy.md). We will never know who uses it, or how often.
- Clones and views show counts to the repository owner, never identities. Stars, forks and watchers show usernames, because those people chose to be seen.
- I believe GitHub's clone count covers `git clone` and not later fetches, so updates likely do not show; to be confirmed, not assumed.

## The funnel (no purchase)

1. A visit to laneconductor.com (analytics, once added).
2. A click on "copy install command" (event).
3. A click to GitHub, or to the comparison page (events).
4. Stars, clones and directory installs (GitHub and the portal).
5. Later: someone posts or links about it (referrers, Search Console).

## Requirements

- REQ-1 A baseline and a weekly snapshot (stars, forks, unique clones, unique views, referrers) are kept in this track's history.md, one line per week, so the 14-day limit does not lose the trend.
- REQ-2 Site analytics are Google Analytics 4 (owner's choice, 2026-11-20: the Google tools are already in use), loaded with Google's own tag (gtag.js) as in Otralingo (`frontend/src/analytics/gtag.ts`): started only after the visitor accepts a small consent notice, `allow_google_signals` and `allow_ad_personalization_signals` off, an opt-out that stops sending, and only page views plus the named events. The site says in one sentence what it counts. The plugins and docs/privacy.md stay unchanged: the plugins have no analytics. (The analytics-tracking skill in `.claude/skills/analytics-tracking` has the GA4 notes.)
- REQ-3 A real `sitemap.xml` and `robots.txt` are served by the site (today the catch-all rewrite returns the home page for both; a file in `landing/` is served before the rewrite), and the site is verified in Search Console. Verification uses an HTML file or a meta tag served by the site, so no DNS record is needed (a domain-wide DNS verification is optional and not required).
- REQ-4 Every campaign has a kit (post text, tagged link, any image or demo), a named owner action with a due date, a run window and a kill rule decided before it starts, and a readout that closes it with a reason. The first campaign is a short demo of the first run (install, `go`, the board).
- REQ-5 No number is claimed anywhere (site, README, posts) that this track has not measured.
- REQ-6 Nothing is deployed or posted without the owner's word. The owner chooses the analytics tool, creates its account and does the DNS verification.

## Owner steps (the agent cannot do these)

- Create the Google Analytics 4 property and web stream for laneconductor.com (or link it through the Firebase project), and tell the agent the measurement id (G-XXXXXXXXXX; it is public in the page source).
- Add the site in Search Console (URL-prefix property) and give the agent the verification file or meta tag it shows.
- Post each campaign, and say when it is posted.
- Say "deploy" when a site change is ready.

## Out of scope

Payments, pricing, sales; any telemetry in the plugins; paid advertising; the directory submission itself (track 10148).
