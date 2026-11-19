---
name: firebase-google-sign-in
description: "Add Google-only sign-in to a web app with Firebase Auth in the shared GCP project: popup sign-in in the browser, a Bearer ID token verified on the server with firebase-admin and ADC, and a provisionUser step that maps the Firebase uid to a database row once and survives the first-load race."
when_to_use: "Use when a new product needs login, sign-in, OAuth, Google accounts or user accounts; when writing useAuth, AuthContext, a verifyToken or auth middleware, or a users table keyed by firebaseUid; when sign-in works locally but silently fails on a new domain; or when moving users between Firebase projects."
paths: "src/lib/firebaseConfig.ts, server/auth.mjs"
metadata:
  kind: convention
  stack: [firebase-auth, google-oauth, express, react, prisma, nodejs]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - The product has its own Web App registered in the shared GCP project and Google enabled as a sign-in provider (the user does this in the Firebase console).
    - The server can use ADC for firebase-admin (the vertex-gemini-adc skill covers the local login; deployed functions use their own service account).
  verified: 2026-11-18
---

## Why this works
Observed in the author's own projects with LaneConductor: two products sign in with Google through
Firebase Auth and no password flow, so there is no password to store, reset or leak. One hook was
ported from an earlier product's `signInWithGoogle`. Both products now have their own Web App
registration in the shared GCP project; one moved there from a Firebase project it shared with
another product, and a config note in the other says App Check is registered per web app.

## Recommendation
- Browser: `signInWithPopup(auth, new GoogleAuthProvider())`; `setCustomParameters({ prompt:
  "select_account" })` so a second account can be chosen; `setPersistence(auth,
  browserLocalPersistence)`. `onAuthStateChanged` is the only place user state is set.
- Map `auth/popup-blocked` to "allow popups for this site"; treat `auth/popup-closed-by-user` and
  `auth/cancelled-popup-request` as a cancel, not an error.
- Call the API with `Authorization: Bearer <await user.getIdToken()>`.
- Server: `firebase-admin` with `applicationDefault()`, project from `FIREBASE_PROJECT_ID` or
  `GOOGLE_CLOUD_PROJECT`. Return 401 for a missing or invalid token (one project returns 403 for
  invalid; prefer 401).
- `provisionUser` runs after the token check: look up by `firebaseUid`, create on first sight, and
  on a unique-constraint error (Prisma `P2002`) re-read the row the winning request created.
  Derive the username with a short uid suffix so two people with one display name do not collide.
- The Web App config (`apiKey`, `appId`, and so on) is public client identifiers, per comments in
  both projects. Keep it out of this skill and out of chat anyway; it matches the secret scan's
  Google key pattern. Read it from the console or an existing app.
- Dev login: a button that exists only under `import.meta.env.DEV`, and server `mock:<uid>:...`
  tokens honoured only under `NODE_ENV=test` or an explicit local flag outside production. The
  functions entry forces production and never forwards the flag.

## Claude does
- Write `useAuth`/`AuthContext`, `firebaseConfig.ts` (config values left as placeholders to fill from
  the console), the token middleware and `provisionUser`; add a unique `firebaseUid` column.
- Add a test that fires several authenticated requests in parallel for a brand-new user.
- Add the new domain to a checklist for you; never claim sign-in works from a new domain unverified.

## You run
1. In the Firebase console for the shared project: register the product's Web App, enable Google as
   a sign-in provider, and copy the Web App config into `src/lib/firebaseConfig.ts` yourself.
2. Add every domain the app is served from to Authentication, Settings, Authorized domains: the
   custom domain and the default `.web.app` and `.firebaseapp.com` addresses.
3. Sign in once from the deployed domain in a real browser.

## Pitfalls
- A new Hosting site or custom domain is not added to Authorized domains automatically. One
  product's production sign-in failed silently until the domains were added. Entries are bare
  hostnames with no protocol or port, and `localhost` is needed for development. For the other
  providers, the emulator and security rules see `firebase-auth-basics` in `firebase/agent-skills`.
- The first authenticated page load fires several requests at once; each reaches `provisionUser`
  for a brand-new user and the losers of the create race hit a real unique violation. Catch it and
  re-fetch. Do not make the user retry.
- A user's uid depends on the OAuth client: after moving a product to its own Firebase project, the
  same person got a new uid on first sign-in, although `firebase auth:import` had preserved the old
  one as a dormant record. Without the re-link by email, they got a duplicate empty account
  (observed in one project). That project re-links on any matching email; checking the token's
  `email_verified` first is advice from this skill, not observed.
- Tests that stub every API response hid a call that was made without the token for weeks. Drive a
  signed-in flow with the dummy login before calling it verified.
- Never allow mock tokens by default; guard with both `NODE_ENV` and an explicit flag, as above.
- Popups can be blocked in embedded browsers; the author's projects show only the message, not a
  redirect fallback.

## Unproven
- `signInWithRedirect` as a fallback for blocked popups: neither project implements it.
- Whether App Check registration (a separate per-app step noted in one project's config file)
  belongs in this skill; it was not read in detail.
