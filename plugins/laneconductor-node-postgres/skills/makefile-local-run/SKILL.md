---
name: makefile-local-run
description: "Give a project the standard root Makefile: make help, install-all, db-local, db-seed, db-reset, dev, test-all, stop-all and a product-scoped deploy, so a fresh clone runs with one command and no manual database or .env step."
when_to_use: "Use when creating a new project or scaffolding its run scripts, when a fresh clone needs manual steps to start (npm install, createdb, copy .env, migrate), when adding or fixing Makefile targets, or when the user says make dev, local run, one command, or bootstrap."
paths: "Makefile, package.json, .env.example"
metadata:
  kind: convention
  stack: [make, node, postgres, prisma, vite]
  provenance: observed in the author's own projects with LaneConductor
  prerequisites:
    - The project has an .env.example, a Prisma schema with migrations, and npm scripts dev, db:seed, build, test, test:e2e (Claude adds missing ones).
    - Postgres client tools (psql, createdb, pg_isready) and a local Postgres are installed on the developer machine (the user installs and starts them).
  verified: 2026-11-17
  smoke_check: make help
---

## Why this works
Observed in the author's own projects with LaneConductor: several projects already had a root
Makefile with these target names, and one was built without one until a track added it: a fresh
clone then needed four manual steps in the right order, and even then showed an in-memory fixture,
not the database. Same names in every product means the author and Claude can type `make dev`,
`make db-local` or `make stop-all` in any repo without looking.

## Recommendation
- Root `Makefile`, `.DEFAULT_GOAL := help`, targets `help`, `install-all`, `env-file`, `db-local`,
  `db-seed`, `db-reset`, `db-test`, `dev`, `test-all`, `stop-all`, `deploy` (`files/Makefile.tmpl`).
- `make dev` = `install-all` + `db-local` + `db-seed`, then runs `npm run dev` (API and client
  together) with `.env` exported into that process.
- Database name, host, port and user come from `DATABASE_URL` in `.env`, with
  `postgresql://postgres:postgres@localhost:5432/<product_with_underscores>` as the local fallback.
- `.env` is created from `.env.example` only if absent, never overwritten.
- `db-test` creates and migrates `<db>_test`, and `test-all` depends on it (see isolated-test-database).
- `deploy` is scoped to this product (`--only hosting:<p>,functions:<p>:<fn>`) and is run by you.
- Local prod-touching helpers read the prod secret inline from Secret Manager into one command's
  environment (see postgres-local-neon-prod-secret-manager), as separate `*-prod` targets.

## Claude does
- Write `Makefile` from `files/Makefile.tmpl` (fill `{{product}}`, `{{function}}`,
  `{{gcp_project}}`); the template assumes Vite on 5173 and an API on 3001, change the two
  variables at the top if the project differs.
- Make sure `.env.example`, a Prisma schema with migrations and the npm scripts `dev`, `db:seed`,
  `build`, `test`, `test:e2e` exist; write an idempotent `db:seed` (check before inserting).
- Run `make help` and, only if Postgres is running, `make db-local` to verify; report what failed.

## You run
1. `make db-local` once Postgres is up (creates the database and runs migrations).
2. `make dev` to start the app.
3. `make deploy` when you want to publish; it deploys, so Claude does not run it.

## Pitfalls
- Nothing loads `.env` into the API process unless something does. One project had no dotenv, the
  Prisma CLI read `.env` but `tsx watch` did not, so the API silently fell back to the in-memory
  fixture and a seeded database stayed invisible. `make dev` therefore runs
  `set -a; . ./.env; set +a; npm run dev`.
- Seeding must be idempotent, or `make dev` fails on every run after the first: that project's
  ingest exited 1 when the document already existed, so `db-seed` checks first and skips.
- `unset PORT` before `npm run dev`: a hosting or preview tool can export `PORT`, which makes the API
  collide with the client's port (a comment in the author's Makefile).
- `make test-all` must not need more database than `npm test` already does; in the author's
  project the e2e suite runs on a fixture repository and needs no database.
- `stop-all` must actually kill the ports. One project's first `stop-all` only printed "press
  Ctrl+C" and was later replaced with `lsof -ti:<port>` and `kill -9`. Another uses plain `kill`
  on the same lsof list, which the template copies; whether plain `kill` is enough on every
  machine is UNVERIFIED.
- One older project's deploy target is `deploy-prod` and it has a `make prod` that runs the dev
  stack against the production database; do not copy either. Use `deploy`, and keep prod-touching
  commands as explicit `*-prod` targets.
- `db-reset` runs `prisma migrate reset --force` against whatever `DATABASE_URL` resolves to. The
  template refuses a non-local host; the author's projects have no such guard (a guard added by
  this skill, not observed in them).
- `db-test` is this skill's addition: the author's project created its test database by a one-time
  manual command and flagged automating it as a follow-up that its Makefile never got.
- The template's `help` echoes are hand-written; add a line when adding a target.

## Unproven
- `lsof` is assumed present (Linux and macOS). Windows without WSL has not been tried.
