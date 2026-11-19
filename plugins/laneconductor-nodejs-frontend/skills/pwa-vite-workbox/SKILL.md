---
name: pwa-vite-workbox
description: "Make a Vite app an installable PWA with vite-plugin-pwa and Workbox the way the author's apps do: standalone manifest with maskable icons, a prompt-style update toast, the offline copy answering only the app's own routes, public pictures with a content revision, and the service worker off in development."
when_to_use: "Use when adding install to home screen, offline support, a manifest, a service worker or vite-plugin-pwa to a web app; when an installed app shows old pictures or old pages after a deploy; when a link opens a redirect or the wrong page on a phone that has the app installed; or when the production build fails on the precache size limit."
paths: "vite.config.ts, vite.config.js"
metadata:
  kind: convention
  stack: [pwa, vite, workbox, vite-plugin-pwa, service-worker, react]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - A Vite app that already builds; icons 192 and 512 px (any) and 192 and 512 px (maskable) exist in public/ (the human supplies the artwork).
  verified: 2026-11-18
---

## Why this works
Observed in the author's own projects with LaneConductor: three apps are installable on phones.
One of them found, one at a time, every way a service worker can serve the wrong thing; a second
copied its pattern and the third chose the simpler auto-update variant. This skill starts from the
first app's fixed configuration so the same incidents do not repeat.

## Recommendation
- `vite-plugin-pwa` with `registerType: 'prompt'` (two apps): the app shows a toast and the user
  chooses when to reload. `autoUpdate` is the third app's choice for a simple app with no
  long-running state.
- Disable the service worker in development: `disable: process.env.NODE_ENV === 'development'`.
- Manifest: `display: 'standalone'`, `scope` and `start_url` `/`, `theme_color` and `background_color`,
  icons 192 and 512 with `purpose: 'any'`, plus the same two with `purpose: 'maskable'`.
- Workbox: `globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']`; static build files only, never
  user data or API responses, and never an authenticated or per-user response in Cache Storage. With an API on the same origin, keep `/api/` out of the navigation
  fallback (`navigateFallbackDenylist`).
- Let the offline copy answer only the app's own routes: `navigateFallbackAllowlist` built from one
  exported list of route prefixes, and a test that fails when the router gains a route missing from
  it. Campaign and marketing pages go to the network.
- Public pictures need a content revision: set `dontCacheBustURLsMatching` to the pattern of Vite's
  hash-named build files only (the author's: `/^assets\/[^/]+-[\w-]{8}\.\w+$/`).
- Update toast: `reg.update()` every 60 s, show on `updatefound` then `installed` only when a
  controller already exists, reload through the skipWaiting and `controllerchange` handshake.
- Register manually (`injectRegister: null`, `register('/sw.js', { scope: '/', updateViaCache:
  'none' })`) when the toast needs the registration object.

## Claude does
- Edit `vite.config.ts` and add the registration module, the toast component and the route list with
  its test; add the new strings in every shipped language.
- Run `npm run build` and report the precache size; run the app's tests.
- Not generate brand artwork; ask you for the icons.

## You run
1. Open the production build in Chrome, DevTools, Application, confirm the manifest and that the
   service worker is active and the app is installable.
2. After a deploy, open the installed copy on a phone and check that a changed picture and a new
   page appear. Claude cannot test an installed copy.

## Pitfalls
- Replaced pictures never reached installed apps: the Workbox default treats every file under
  `assets/` as hash-named (revision null), so a picture replaced under the same name was never
  refetched. Only Vite's own hash-named build files should skip the revision.
- An old offline copy turned a campaign link into a redirect to the app: the worker answered every
  navigation. Hence the allowlist of the app's own routes.
- The production build failed when one chunk passed the 2 MiB precache default (2.1 MB); the fix
  was splitting libraries into their own chunks, not raising the limit. Later splitting by route,
  game and language left the largest chunk near 0.9 MB.
- The service worker in development intercepted local POST requests and left fetches hanging
  (a comment in one app's config); keep it off outside production builds.
- A white page after a deploy and a version check that reads the precache are covered by the
  cache-buster skill.
- Push notifications are a separate step: one app adds `importScripts: ['push-sw.js']`; nothing
  here was verified beyond that line.

## Unproven
- iOS behaviour of install and the toast: no test on an iPhone was recorded.
- Whether `autoUpdate` has caused stale-copy trouble; nothing observed shows an incident either way.
