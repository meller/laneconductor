---
name: ga4-gtag-with-consent
description: "Add Google Analytics 4 the privacy-friendly way: Google's own tag (gtag.js) with your own measurement id, loaded only after the visitor accepts, advertising features off, an opt-out that stops sending, a few named events with safe parameters, a first-touch campaign source, plus Search Console ownership and a real sitemap.xml and robots.txt with a test."
when_to_use: "Use when adding or fixing Google Analytics, when events do not arrive or the tag loads with id=undefined, when a cookie notice must gate analytics, when tracking a launch or a campaign with utm links, when a site needs Search Console, a sitemap or a robots.txt, or when a Firebase Hosting site wants page-view and click numbers. Not for ad products."
paths: "index.html, firebase.json, public/robots.txt, public/sitemap.xml"
metadata:
  kind: convention
  stack: [google-analytics, ga4, gtag, consent, search-console, seo, firebase-hosting]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - A GA4 property with a web data stream and its measurement id (G-...), created by a human in Google Analytics.
    - The site is served from a host you control, so a verification file or a meta tag can be added to it.
  verified: 2026-11-20
---

## Why this works
Observed in one of the author's apps: Analytics runs through Google's own tag with the app's own
measurement id, starts only after the visitor chooses "Allow analytics", and has the advertising
features off. The first attempt used the Firebase Analytics SDK, which takes the id from Firebase's
server config. Right after Google Analytics was linked that config had no id, the SDK preferred it
over the app's own, and the tag loaded with `id=undefined` and sent nothing (from the code's own
comment; it was not reproduced here). Loading the tag directly with your own id removes that
dependency. The same app keeps event parameters to short codes, so no personal data can leak into
an event by accident.

## Recommendation
- The measurement id is public (it is in the page source), so keep it in build config or one
  constant; with no id, do nothing at all.
- Start the tag only with consent. Keep the choice in `localStorage`; on page load start the tag if
  consent was given before, and on Accept; never in local development; never before the choice. Use
  Google's snippet shape (`dataLayer.push(arguments)`, not a rest-parameter function), then
  `gtag('config', ID, { allow_google_signals: false, allow_ad_personalization_signals: false })`,
  then add the script `https://www.googletagmanager.com/gtag/js?id=` plus the encoded id.
- Google's docs (checked 2026-11-20): `allow_google_signals: false` turns off the advertising
  features; `allow_ad_personalization_signals: false` stops ads personalization but keeps
  demographics and interests reporting.
- Opt-out: `window['ga-disable-<ID>'] = true`. Google says it must be set before any `gtag()` call and
  on each page. So on every load, set it first when the visitor has declined, and offer a way to
  withdraw later.
- One small `track(name, params)` that does nothing until the tag has started, keeps only numbers,
  booleans and short code-like strings (at most 60 characters, no whitespace, no `@`), and swallows
  errors: analytics must never break the page. Name a handful of events (for a project site: copy of
  the install command, click to the repository, click to the docs).
- Campaign source: tag links `?utm_source=<channel>&utm_campaign=<name>`. GA reads them itself. To
  keep the first touch for your own numbers, read the utm values, the landing path and the referring
  host name (not the URL) on the first page of the visit, keep them in `sessionStorage` with the
  first value winning, and clip each to 80 characters.
- Search Console: add a URL-prefix property. Google's methods (checked 2026-11-20): an HTML file
  (reachable without sign-in, and it must stay in place), an HTML tag in the `<head>`, the Google
  Analytics tag, a Tag Manager container; only a Domain property needs a DNS record. Prefer the file
  or the meta tag: a consent-gated tag is not on the page for a visitor who declined (inferred).
- `sitemap.xml` and `robots.txt` are real files in the hosting folder. On the author's Firebase
  Hosting sites a catch-all rewrite to `index.html` answered both with the home page until the files
  existed; a file is served before the rewrite. `robots.txt`: `User-agent: *`, `Allow: /`, a
  `Disallow` per private route, and `Sitemap: https://<site>/sitemap.xml`.
- Test the two files against the real ones: every sitemap URL is on the real origin and is a page
  that exists; `/` is not disallowed; the sitemap line is present; every `Disallow` route exists;
  every protected route is covered (longest matching rule wins, `Allow` wins a tie).
- One canonical URL per page. The author's Search Console reported "Page with redirect" and
  "Duplicate without user-selected canonical" until the landing page was served at `/` with no
  client-side redirect and the alternate path declared `/` as its canonical.

## Claude does
- Reads the page head, the hosting config and any existing analytics; adds the consent notice, the
  tag start and `track` from `files/consent-gtag.js.tmpl` (a static page) or the same shape in the
  app's own language. Never invents a measurement id: asks for it.
- Writes one sentence on the page saying what is counted, the sitemap and robots tests, and a unit
  test that `track` is a no-op before consent and drops values that look like emails or sentences.
- Leaves the deploy and the Search Console button to you.

## You run
1. Create the GA4 property and web stream; give Claude the measurement id.
2. In Search Console add the property, download the file or copy the tag for Claude to add, deploy,
   press Verify, and submit the sitemap.
3. Open the deployed page: with no choice made there must be no request to `googletagmanager.com`
   (Network tab); after Accept there must be one, and Realtime in GA4 shows your visit and events.

## Pitfalls
- A tag started by an SDK that reads its id from a server config can load with `id=undefined`
  (the incident above). Use your own id.
- `ga-disable-<ID>` set after the first `gtag()` call is outside what Google documents. Set it first.
- Asking for consent after loading the tag defeats the point. Ask first, load second.
- A verification file the deploy deletes loses the verification; keep it in the hosting folder.
- Free text or an email in an event parameter is personal data in a report. Drop it in `track`.

## Unproven
- Whether turning `ga-disable-<ID>` on at runtime, after the tag started, stops events right away.
  The author's app does it on its Preferences toggle; test it before relying on it.
- How the author's own Search Console property was verified: no file or meta tag was found in that
  repository (so probably DNS or the Analytics method); not checked.
- That Analytics-tag verification fails for a visitor who has not consented: inferred, not tried.
