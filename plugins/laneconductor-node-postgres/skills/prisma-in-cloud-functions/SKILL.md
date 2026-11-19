---
name: prisma-in-cloud-functions
description: "Run Prisma in a Firebase Functions app the way the author's apps do: the functions folder has its own package.json with prisma and a postinstall generate, the root prisma folder is the single source and is synced in at deploy, runtime packages are declared in both package.json files and a test enforces it, and generate always follows a schema push."
when_to_use: "Use when a project with Prisma deploys its API to Cloud Functions or Firebase Functions; when writing functions/package.json, a deploy script that syncs the schema, or a prisma.config.ts; when production returns 500 on every route after a deploy with ERR_MODULE_NOT_FOUND; or when Prisma says a column does not exist right after a schema push."
paths: "functions/package.json, prisma/schema.prisma, prisma.config.ts"
metadata:
  kind: convention
  stack: [prisma, firebase-functions, nodejs, postgres, neon]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - The project already has the database layout of the postgres-local-neon-prod-secret-manager skill.
  verified: 2026-11-18
---

## Why this works
Observed in the author's own projects with LaneConductor: three products run Prisma inside a
Functions app. The deployed function does not use the repository's root `node_modules`; it installs
from `functions/package.json`. Most of the incidents below come from that split, and each one
passed every local test.

## Recommendation
- `functions/package.json` lists `prisma`, `@prisma/client` and, for the driver adapter, `pg` and
  `@prisma/adapter-pg`; its `scripts.postinstall` is `prisma generate`.
- The root `prisma/` folder is the only place the schema is edited. The deploy script copies it in:
  `rsync -a --delete prisma/ functions/prisma/` (two projects) or a `prebuild` copy of
  `schema.prisma` (the third). Do not hand-edit `functions/prisma/`.
- In the deploy script, run `npm install` inside `functions/` and `prisma generate` there before any
  migration, schema push or data copy, so a failure comes before the database changes.
- Every package the server imports is declared in `functions/package.json` as well as the root one;
  add a test that reads both and fails on the gap.
- After `prisma db push`, run `prisma generate` in the same script, then seed.
- Database client: a single exported client module. One project uses the plain client; another
  wraps a `pg` Pool in `PrismaPg`; the third uses `PrismaPg` locally and the Neon adapter in
  production. New products follow the connection layout of the postgres skill and, unless there is
  a reason, use the plain client.

## Claude does
- Write `functions/package.json` entries, the deploy-script steps and the dependency test from the
  shapes above; run the test and `npx prisma generate` locally.
- Keep `.env.example` and `prisma.config.ts` reading `DATABASE_URL` only; never put a value in
  either.
- Never run a schema push or migration against production; those are `make` targets that you run.

## You run
1. `make deploy` (or the project's deploy script) for the first deploy, and read the install step's
   output yourself.
2. The production schema step (`migrate deploy` or `db push`) when the schema changed, with the
   database URL read from Secret Manager into that one command (see the postgres skill).

## Pitfalls
- A package imported by the server but missing from `functions/package.json` passes every test and
  takes the whole API down on deploy: `stripe` was added to the root only, and the first production
  deploy of a payment feature returned 500 on every route. `nodemailer` had the same gap silently
  because it is imported lazily and fails soft.
- `firebase-functions` must be installed in `functions/` before the deploy starts the migrations: a
  deploy aborted with "Couldn't find firebase-functions package" after the migrations and the data
  copy had run, leaving production with new data and old code (a comment in the author's deploy
  script).
- `prisma db push` did not reliably refresh the installed client in one project's setup
  (`prisma.config.ts` plus the Neon adapter); a stale client failed an unrelated upsert with P2022
  "column does not exist", which looks like production schema drift. Always `generate` after a push.
  Prisma's own v7 reference lists the auto-generate switches as no longer needed, which suggests
  Prisma 7 stopped generating on install and after a push (read 2026-11-19, not run); that would
  explain this and why the explicit `postinstall: prisma generate` is needed.
- `db push` failed with P1014 "table does not exist" through Neon's pooled endpoint and passed through
  the direct one with no other change. Use the direct endpoint for schema commands (details in the
  postgres skill).
- One project's local setup runs `SET search_path` on every pooled connection for a named schema;
  the author's LLM gateway package learned that this poisons shared backends behind a pooler (see
  llm-through-tokentalos). Only do it against local Postgres.

## Unproven
- Why one project uses the plain client while the other two use driver adapters; no commit message
  or document records the reason.
- Prisma 5 (two projects) versus Prisma 7 (one) differences beyond the config file:
  `prisma.config.ts` appears only in the Prisma 7 project and nothing here verifies that it is
  required.
