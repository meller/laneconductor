---
name: cache-buster
description: "Make sure users get a new deploy: Firebase Hosting headers that keep index.html uncached and hashed assets immutable, a build stamp written into index.html and the bundle, a poll that compares the two and shows a Reload banner, and a one-shot recovery when a stale tab asks for files the deploy removed."
when_to_use: "Use when a deployed change is not visible to users, when users see a white page or a failed lazy chunk after a deploy, when writing firebase.json headers, a version check, an update banner or a stale tab notice; or when adding a service worker and asking how old copies get replaced."
paths: "firebase.json, vite.config.ts"
metadata:
  kind: convention
  stack: [firebase-hosting, vite, react, cache, spa]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - The app is a Vite single-page app served from Firebase Hosting (see shared-gcp-firebase-site).
  verified: 2026-11-18
---

## Why this works
Observed in the author's own projects with LaneConductor: users of one app saw stale bundles after
a deploy for as long as they did not hard refresh, and then a white page when a stale tab asked
for a script the deploy had replaced. A second app took the idea, dropped the service worker, and
keeps only what a plain Hosting SPA needs: correct headers plus a polite banner. Both refuse to
reload by themselves: a user may be mid-audio or mid-round.

## Recommendation
- `firebase.json` `hosting.headers`: `/` and `/index.html` get `Cache-Control: no-cache`; hashed
  files (`**/*.@(js|css|png|jpg|jpeg|gif|ico|svg|webmanifest)`) get `max-age=31536000, immutable`.
  Hosting's own default for HTML is `max-age=3600`, so without this a browser keeps the old shell
  and therefore the old bundle for up to an hour.
- One build stamp per build (`<git short sha>@<UTC time>`), put in two places: `define:
  { __APP_BUILD__ }` for the running bundle, and `<meta name="app-build" content="...">` in
  `index.html` through a small `transformIndexHtml` plugin. The source `index.html` carries
  `content="dev"`.
- Poll `fetch("/", { cache: "no-store" })` every 60 s and when the tab becomes visible; parse the
  meta tag; when it differs from `__APP_BUILD__`, report once and stop polling. Enabled in
  production only.
- The UI offers a Reload button. It never reloads on its own.
- Stale-tab recovery: a tiny plain script loaded before the app that, when an `/assets/` file or a
  lazy chunk fails to load, reloads once (guard: one automatic reload per minute, kept in
  `sessionStorage`) and shows "Updating... tap to reload" if the app has not started in 10 s. For a
  failed lazy import alone, a `vite:preloadError` listener is a simpler hook (a public skill's
  advice, not yet used by the author's apps). For the service-worker side see
  `pwa-offline-cache-contracts` in `voidmatcha/frontend-niche-skills`.

## Claude does
- Add the headers, the build stamp, the poll and the banner from the shape above, with the poll's
  `fetch` and the reload injectable so a unit test can drive them.
- Add the new strings to every language the app ships.
- Verify headers with `curl -sI` against the deployed URL after a deploy only if you ask; the
  deploy itself is yours.

## You run
1. Deploy (`make deploy`), open the app, deploy again with any change, and wait up to a minute
   with the first tab still open: the banner should appear. Then press Reload.
2. On a phone installed as an app, repeat once; installed copies are where stale builds last.

## Pitfalls
- Hosting answers a missing `/assets/...` file with `index.html` (the `**` rewrite), so a stale tab
  that asks for a replaced chunk gets HTML, the module fails and the page stays white. The recovery
  script exists for exactly this. The explanation is inferred from the rewrite rule and the
  script's comment; it was not reproduced here.
- With a service worker, a poll that goes through the worker reads the old cached shell and never
  sees the new build. The check must reach the server (`cache: "no-store"`) and then hand the
  update to the waiting worker.
- Compare against the running build, not a value stored earlier: one app stored the version and
  the comparison lagged, so every update reloaded the page a minute later.
- A forced `window.location.reload()` was the first design in one app and was removed; a user
  mid-audio or mid-game loses state.
- The immutable glob matches by extension, not by hash, so a picture replaced under the same name
  in `public/` would stay cached for a year (inferred; the same bug appeared inside one app's
  service worker, see the pwa skill). Prefer hashed names for anything long-cached.

## Unproven
- Whether the 60 s interval is right for a cost-sensitive app; it is one request to `/` per tab per
  minute, and no measurement of the cost exists.
- The `webmanifest` immutable header: one app sets it, but a manifest whose name changes under
  a stable URL would then be cached for a year. Not checked against a real update.
