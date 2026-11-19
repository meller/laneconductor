---
name: shared-gcp-firebase-site
description: "Host a new product as its own Firebase Hosting site plus its own Functions codebase inside one shared GCP project (<shared-project>), with deploys scoped to that product only. Not a new GCP project per product."
when_to_use: "Use when a new web app needs hosting, an API on Cloud Functions, or a deploy target; when about to run gcloud projects create or firebase projects:create; or when writing firebase.json or .firebaserc."
paths: "firebase.json, .firebaserc"
metadata:
  kind: convention
  stack: [gcp, firebase-hosting, firebase-functions-v2, nodejs22, vite]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - The user is signed in to the firebase and gcloud CLIs with access to the shared GCP project (the user runs the sign-in).
    - The product has a short kebab-case id, used for the hosting target and the codebase, and a Hosting site id <site> chosen by the user.
  verified: 2026-11-17
  smoke_check: firebase hosting:sites:list --project <shared-project>
---

## Why this works
Observed in the author's own projects with LaneConductor: the newer products all default to one
shared GCP project. Each gets its own Hosting site, and the newer ones also get their own Functions
codebase, so billing, Secret Manager and Application Default Credentials live in one place. It is
not universal: a couple of older projects use their own GCP projects. This skill is the layout for
new products unless the owner says otherwise.

## Recommendation
- One Hosting site per product (site id `<site>`; the author used `<product>` plus a fixed suffix
  of their own), hosting target `<product>`, Functions `codebase: "<product>"`, runtime
  `nodejs22`, one HTTPS function named `<product-without-dashes>api`.
- Hosting rewrites: `/api/**` to the function, `**` to `/index.html`.
- Register the Express routes under `/api/...` (Hosting forwards the whole path), health check at
  `/api/health` (see Pitfalls for why not a path ending in `z`).
- Deploy only this product: `firebase deploy --only hosting:<product>,functions:<product>:<fn>`,
  wrapped in a `make deploy` target (see the makefile-local-run skill).

## Claude does
- Write `.firebaserc` and `firebase.json` from `files/`, filling the `{{product}}`, `{{site}}`,
  `{{function}}` and `{{gcp_project}}` placeholders.
- Add `GCP_PROJECT=<shared-project>` and `GCP_REGION=us-central1` to `.env.example`.

## You run
1. `firebase hosting:sites:create <site> --project <shared-project>`
2. `firebase target:apply hosting <product> <site> --project <shared-project>`
   (only needed if `.firebaserc` was not written from the template, which already holds the mapping)
3. `make deploy` once the app builds (it deploys only this product).

## Pitfalls
- Give each product its own `codebase`: without one, the CLI offers to delete the other
  repository's functions (Firebase docs, "Organize functions"). Two of the author's projects still
  use `codebase: "default"`; do not copy that. Names: lowercase letters, digits, underscores and
  dashes, under 63 characters.
- Scope every deploy with `--only`. The `functions:<codebase>:<fn>` form is documented in
  `firebase deploy --help`. Never pass `--force` in a shared project: it deletes functions that are
  missing from the local source.
- Use `/api/**`, not `/api**`. Observed live in one of the author's projects: `/api**` matches
  `/apifoo` but not `/api/health`. The Firebase docs do not state this. Bare `/api` is not matched by
  `/api/**` either.
- Cloud Run's known-issues page says some paths ending in `z` are reserved and recommends avoiding
  all paths that end in `z` (read 2026-11-19 through a page summary). Functions v2 runs on Cloud Run,
  so treat that as applying; the earlier convention `/api/healthz` ends in `z`. Use `/api/health`.
- This layout has a hard ceiling: a Firebase project allows at most 36 Hosting sites (Firebase
  Hosting docs, read 2026-11-19 through a page summary). For the Hosting commands themselves see
  `firebase-hosting-basics` in `firebase/agent-skills`.

## Unproven
- A new GCP project per product reportedly hit a project quota during one of the author's builds.
  It was recorded only in a track note, with no document or run behind it, so treat it as
  hearsay.
